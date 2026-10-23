import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import asset from '../../data/generated/land-borders.json';
import { useAppStore } from '../../state/appStore';
import { BordersResult } from './BordersResult';
import {
  bordersCountryColors,
  CROSSING_BANDS,
  ROUTE_COLORS,
} from './bordersPalette';
import {
  createLandBorderGraph,
  findRoute,
  summarizeReach,
} from './landBorders';

const graph = createLandBorderGraph(asset);
const ready = { status: 'ready' as const, data: graph };

afterEach(() => {
  cleanup();
  useAppStore.setState({ bordersDestination: null });
});

function presentation(
  start: { countryId: string; name: string } | null,
  destination: string | null,
) {
  return {
    id: 'borders' as const,
    selectedCountry: start,
    destination,
    data: ready,
    reach: start ? summarizeReach(graph, start.countryId) : null,
    route:
      start && destination
        ? findRoute(graph, start.countryId, destination)
        : null,
  };
}

describe('BordersResult', () => {
  it.each([
    ['ne-250', 'France', 'ne-076'],
    ['ne-724', 'Spain', 'ne-504'],
    ['ne-643', 'Russia', 'ne-616'],
  ])(
    'identifies detached departure and arrival for %s',
    (countryId, name, destination) => {
      const trip = presentation({ countryId, name }, destination!);
      expect(trip.route).toMatchObject({ status: 'route', crossings: 1 });
      const { rerender } = render(
        <BordersResult locale="en" presentation={trip} />,
      );
      expect(
        screen.getByTestId('borders-route').querySelector('li'),
      ).toHaveTextContent('Starts in a detached territory');
      expect(screen.getByTestId('borders-result')).toHaveTextContent(
        'not a route from the clicked coordinates',
      );
      rerender(<BordersResult locale="zh" presentation={trip} />);
      expect(
        screen.getByTestId('borders-route').querySelector('li'),
      ).toHaveTextContent('从其分离领土出发');
      const reverse = presentation(
        { countryId: destination!, name: destination! },
        countryId!,
      );
      rerender(<BordersResult locale="en" presentation={reverse} />);
      expect(
        screen.getByTestId('borders-route').querySelector('li:last-child'),
      ).toHaveTextContent('Ends in a detached territory');
    },
  );

  it('summarizes reach and turns a neighbour into the destination', () => {
    render(
      <BordersResult
        locale="en"
        presentation={presentation(
          { countryId: 'ne-156', name: 'China' },
          null,
        )}
      />,
    );
    expect(
      screen.getByText(
        /China shares land borders with 16 countries or territories/u,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Mongolia as the destination' }),
    );
    expect(useAppStore.getState().bordersDestination).toBe('ne-496');
  });

  it('lists the route with fixed links and detached parts', () => {
    render(
      <BordersResult
        locale="zh"
        presentation={presentation(
          { countryId: 'ne-826', name: 'United Kingdom' },
          'ne-724',
        )}
      />,
    );
    expect(
      screen.getByText(
        '从英国到西班牙，不坐船、不乘飞机，最少要跨越 2 条边界。',
      ),
    ).toBeInTheDocument();
    const steps = screen.getByTestId('borders-route').querySelectorAll('li');
    expect([...steps].map((step) => step.dataset.countryId)).toEqual([
      'ne-826',
      'ne-250',
      'ne-724',
    ]);
    expect(steps[1]).toHaveTextContent('经英吉利海峡隧道');
  });

  it('states when no land route exists or no start is selected', () => {
    const { rerender } = render(
      <BordersResult
        locale="en"
        presentation={presentation(
          { countryId: 'ne-392', name: 'Japan' },
          'ne-156',
        )}
      />,
    );
    expect(
      screen.getByText(/No land route joins Japan and China/u),
    ).toBeInTheDocument();
    rerender(
      <BordersResult locale="en" presentation={presentation(null, null)} />,
    );
    expect(
      screen.getByText(/Select a country or territory/u),
    ).toBeInTheDocument();
  });
});

describe('bordersCountryColors', () => {
  it('colours reach bands, or only the route once a destination is set', () => {
    const reach = summarizeReach(graph, 'ne-156');
    const bands = bordersCountryColors(reach, null);
    expect(bands.get('ne-496')).toBe(CROSSING_BANDS[0].color);
    expect(bands.has('ne-392')).toBe(false);
    expect(new Set(bands.values()).size).toBe(CROSSING_BANDS.length);

    const route = findRoute(graph, 'ne-156', 'ne-250');
    const colors = bordersCountryColors(reach, route);
    expect(colors.get('ne-250')).toBe(ROUTE_COLORS.destination);
    expect(colors.has('ne-156')).toBe(false);
    expect(colors.size).toBe(route.status === 'route' ? route.crossings : -1);
    expect(bordersCountryColors(reach, { status: 'unreachable' }).size).toBe(0);
  });
});
