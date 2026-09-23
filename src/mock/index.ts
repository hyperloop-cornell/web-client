/**
 * In-browser mock backend, so the web client can run with no cloud-services or hubs behind it.
 *
 * Start it with `npm run dev:mock`. Two seams are faked:
 *   - REST:      an Axios adapter installed on the shared `api` instance (./rest.ts)
 *   - WebSocket: a stand-in for `new WebSocket(...)` used by websocket.ts (./socket.ts)
 *
 * Every payload is typed with the types generated from cloud-services' contract, so the mock
 * cannot drift from the real API without failing `npm run type-check`. For end-to-end testing
 * against the real code paths, run cloud-services with rpi-hub-server's `dev-sim` profile instead.
 *
 * State lives in memory and resets on page reload. The mock only activates in the Vite dev
 * server, never in a production build.
 */
export const MOCK_HUBS_ENABLED = import.meta.env.DEV && import.meta.env.VITE_MOCK_HUBS === 'true';

export { installMockAdapter, MOCK_TEAM_PASSWORD } from './rest';
export { createMockSocket } from './socket';
