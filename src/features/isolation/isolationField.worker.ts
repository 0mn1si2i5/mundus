import {
  buildIsolationFieldTable,
  type IsolationFieldSite,
} from './isolationField';

const scope = self as unknown as {
  onmessage:
    ((event: MessageEvent<readonly IsolationFieldSite[]>) => void) | null;
  postMessage: (data: unknown, transfer: Transferable[]) => void;
};
scope.onmessage = (event) => {
  try {
    const table = buildIsolationFieldTable(event.data);
    scope.postMessage({ status: 'ready', table }, [
      table.tiles.buffer,
      table.candidates.buffer,
    ]);
  } catch (error) {
    scope.postMessage(
      {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
      [],
    );
  }
};
