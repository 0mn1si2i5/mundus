export function cityRank(cities) {
  const ranks = new Uint16Array(cities.length + 1);
  [...cities]
    .sort(
      (left, right) => right.population - left.population || left.id - right.id,
    )
    .forEach((city, index) => {
      ranks[city.ownerIndex] = index + 1;
    });
  return ranks;
}

/** Indexed binary heap: one entry per cell, no unbounded stale queue entries. */
export function createWorkspace(size) {
  const distance = new Float64Array(size).fill(Infinity);
  const owner = new Uint16Array(size);
  const position = new Int32Array(size).fill(-1);
  const settled = new Uint8Array(size);
  const unknownPath = new Uint8Array(size);
  const nodes = new Uint32Array(size);
  const touched = new Uint32Array(size);
  let length = 0;
  let touchedCount = 0;
  let rank = null;
  const less = (left, right) =>
    distance[left] < distance[right] ||
    (distance[left] === distance[right] &&
      (rank?.[owner[left]] ?? 0) < (rank?.[owner[right]] ?? 0)) ||
    (distance[left] === distance[right] &&
      (rank?.[owner[left]] ?? 0) === (rank?.[owner[right]] ?? 0) &&
      left < right);
  const swap = (a, b) => {
    const value = nodes[a];
    nodes[a] = nodes[b];
    nodes[b] = value;
    position[nodes[a]] = a;
    position[nodes[b]] = b;
  };
  return {
    distance,
    owner,
    settled,
    unknownPath,
    reset(nextRank = null) {
      for (let index = 0; index < touchedCount; index += 1) {
        const cell = touched[index];
        distance[cell] = Infinity;
        owner[cell] = 0;
        position[cell] = -1;
        settled[cell] = 0;
        unknownPath[cell] = 0;
      }
      length = 0;
      touchedCount = 0;
      rank = nextRank;
    },
    offer(cell, nextDistance, nextOwner = 0, viaUnknown = 0) {
      if (
        settled[cell] ||
        nextDistance > distance[cell] ||
        (nextDistance === distance[cell] &&
          (rank?.[nextOwner] ?? 0) >= (rank?.[owner[cell]] ?? 0))
      )
        return false;
      if (!Number.isFinite(nextDistance) || nextDistance < 0)
        throw new Error('Dijkstra requires finite nonnegative costs');
      if (!Number.isFinite(distance[cell])) touched[touchedCount++] = cell;
      distance[cell] = nextDistance;
      owner[cell] = nextOwner;
      unknownPath[cell] = viaUnknown ? 1 : 0;
      let slot = position[cell];
      if (slot < 0) {
        slot = length++;
        nodes[slot] = cell;
        position[cell] = slot;
      }
      while (slot > 0) {
        const parent = (slot - 1) >> 1;
        if (!less(nodes[slot], nodes[parent])) break;
        swap(slot, parent);
        slot = parent;
      }
      return true;
    },
    pop() {
      if (!length) return -1;
      const cell = nodes[0];
      position[cell] = -1;
      length -= 1;
      if (length) {
        nodes[0] = nodes[length];
        position[nodes[0]] = 0;
        let slot = 0;
        while (true) {
          const left = slot * 2 + 1;
          if (left >= length) break;
          const right = left + 1;
          const best =
            right < length && less(nodes[right], nodes[left]) ? right : left;
          if (!less(nodes[best], nodes[slot])) break;
          swap(slot, best);
          slot = best;
        }
      }
      settled[cell] = 1;
      return cell;
    },
    get visitedCount() {
      return touchedCount;
    },
  };
}

export function solveOwnership(
  graph,
  cities,
  level,
  workspace = createWorkspace(graph.size),
) {
  if (!Number.isFinite(level) || level < 0 || !cities.length)
    throw new Error('Invalid reach level or empty city universe');
  const ranks = cityRank(cities);
  workspace.reset(ranks);
  const maximumLog = Math.max(
    ...cities.map((city) => Math.log10(city.population)),
  );
  for (const city of cities) {
    const offset = level * (maximumLog - Math.log10(city.population));
    for (const source of city.sourceCells) {
      if (!graph.land[source])
        throw new Error(`City ${city.id} has a non-traversable source cell`);
      workspace.offer(
        source,
        offset,
        city.ownerIndex,
        graph.unknownLand?.[source],
      );
    }
  }
  let cell;
  while ((cell = workspace.pop()) >= 0) {
    graph.neighbours(cell, (next, cost) => {
      workspace.offer(
        next,
        workspace.distance[cell] + cost,
        workspace.owner[cell],
        workspace.unknownPath[cell] || graph.unknownLand?.[next],
      );
    });
  }
  return {
    owners: workspace.owner.slice(),
    distances: workspace.distance,
    visitedCells: workspace.visitedCount,
    unknownPaths: workspace.unknownPath,
  };
}

export function centreThresholds(
  graph,
  cities,
  workspace = createWorkspace(graph.size),
) {
  const byOwner = new Map(cities.map((city) => [city.ownerIndex, city]));
  const ranks = cityRank(cities);
  const sourceOwners = new Uint16Array(graph.size);
  for (const city of cities) {
    for (const source of city.sourceCells) {
      if (sourceOwners[source] && sourceOwners[source] !== city.ownerIndex)
        throw new Error(`Retained city sources overlap at cell ${source}`);
      sourceOwners[source] = city.ownerIndex;
    }
  }
  const maximumLog = Math.max(
    ...cities.map((city) => Math.log10(city.population)),
  );
  const results = new Map();
  for (const city of cities) {
    if (!city.sourceCells.length) {
      results.set(city.id, {
        threshold: null,
        parentId: null,
        status:
          city.mergedIntoId != null
            ? 'merged_at_resolution'
            : 'transport_missing',
        visitedCells: 0,
      });
      continue;
    }
    if (!city.sourceCells.includes(city.centreCell))
      throw new Error(
        `City ${city.id} centre must be in its retained source set`,
      );
    workspace.reset();
    workspace.offer(
      city.centreCell,
      0,
      0,
      graph.unknownLand?.[city.centreCell],
    );
    const currentLog = Math.log10(city.population);
    let best = Infinity;
    let parent = null;
    let travelTimeHours = null;
    let usesUnknownCountryCells = false;
    let cell;
    while ((cell = workspace.pop()) >= 0) {
      const time = workspace.distance[cell];
      // Strict inequality preserves parent tie-breaking at the stopping boundary.
      if (Number.isFinite(best) && best * (maximumLog - currentLog) < time)
        break;
      const candidate = byOwner.get(sourceOwners[cell]);
      if (candidate?.population > city.population) {
        const threshold =
          time / (Math.log10(candidate.population) - currentLog);
        if (
          threshold < best ||
          (threshold === best &&
            (!parent || ranks[candidate.ownerIndex] < ranks[parent.ownerIndex]))
        ) {
          best = threshold;
          parent = candidate;
          travelTimeHours = time;
          usesUnknownCountryCells = Boolean(workspace.unknownPath[cell]);
        }
      }
      graph.neighbours(cell, (next, cost) => {
        workspace.offer(
          next,
          time + cost,
          0,
          workspace.unknownPath[cell] || graph.unknownLand?.[next],
        );
      });
    }
    results.set(city.id, {
      threshold: Number.isFinite(best) ? best : null,
      parentId: parent?.id ?? null,
      status: parent
        ? 'ok'
        : currentLog === maximumLog
          ? 'root'
          : 'no_larger_reachable',
      visitedCells: workspace.visitedCount,
      travelTimeHours,
      usesUnknownCountryCells,
    });
  }
  return results;
}

export function monotonicityViolations(previous, current, cities, land) {
  const population = new Float64Array(cities.length + 1);
  for (const city of cities) population[city.ownerIndex] = city.population;
  let violations = 0;
  for (let cell = 0; cell < current.length; cell += 1) {
    if (
      land[cell] &&
      previous[cell] &&
      current[cell] &&
      population[current[cell]] < population[previous[cell]]
    )
      violations += 1;
  }
  return violations;
}

export function territoryConnectivity(graph, owners, cities) {
  const sources = new Map(
    cities.map((city) => [city.ownerIndex, new Set(city.sourceCells)]),
  );
  const visited = new Uint8Array(graph.size);
  const queue = new Uint32Array(graph.size);
  const fragments = [];
  for (let start = 0; start < graph.size; start += 1) {
    const owner = owners[start];
    if (!owner || visited[start]) continue;
    let head = 0;
    let tail = 1;
    let hasSource = false;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const cell = queue[head++];
      hasSource ||= sources.get(owner)?.has(cell) ?? false;
      graph.neighbours(cell, (next) => {
        if (!visited[next] && owners[next] === owner) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      });
    }
    if (!hasSource)
      fragments.push({ ownerIndex: owner, firstCell: start, cells: tail });
  }
  return fragments;
}
