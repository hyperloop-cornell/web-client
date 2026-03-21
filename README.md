# Hyperloop Web Client

React + TypeScript web interface for monitoring and controlling Cornell Hyperloop electrical systems, connecting to RPI hub servers over WebSocket.

## Features

- Real-time dashboard with hub status monitoring
- Device management and connections
- Live telemetry visualization with custom schemas
- Arduino firmware flashing interface
- WebSocket auto-reconnection with heartbeat monitoring
- JWT-based authentication
- Responsive design with Tailwind CSS
- Type-safe TypeScript codebase

## Prerequisites

- Node.js 18+ and npm
- Chrome/Firefox/Safari (modern browser with ES2020+ support)

## Installation

```bash
git clone <repository-url>
cd web-client
npm install
```

## Configuration

1. Update API endpoint in `src/services/api.ts` if needed:
```typescript
export const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:8000';
export const WS_BASE_URL = process.env.VITE_WS_URL || 'ws://localhost:8000';
```

2. Configure sensor mappings in `src/config/sensor-mappings.json`

3. Configure Arduino sketches in `src/config/arduino-sketches.json`

## Running Locally

Development server with hot reload:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

Type checking and linting:
```bash
npm run type-check
npm run lint
```

## Building for Production

```bash
npm run build
```

Output is in the `dist/` directory. Serve with:
```bash
npm run preview
```

## Project Structure

```
src/
├── components/          # React components
│   ├── auth/           # Authentication components
│   ├── layout/         # Layout components
│   └── ui/             # Reusable UI components
├── pages/              # Page components
│   ├── Dashboard.tsx          # Hub status overview
│   ├── DeviceManager.tsx       # Device connections
│   ├── LiveTelemetry.tsx       # Real-time data visualization
│   └── ArduinoFlash.tsx        # Firmware flashing
├── services/           # API and WebSocket services
│   ├── api.ts          # HTTP client
│   ├── websocket.ts    # WebSocket management
│   ├── commandService.ts
│   └── sensorParser.ts
├── stores/             # Zustand state management
│   ├── authStore.ts    # Authentication state
│   ├── hubStore.ts     # Hub connections state
│   └── telemetryStore.ts # Telemetry data state
├── types/              # TypeScript type definitions
├── lib/                # Utilities
└── config/             # Configuration files
```

## Pages

### Dashboard
Overview of connected hubs with status indicators, uptime, and device counts. 30-second refresh interval.

### Device Manager
View and manage device connections for each hub. Shows connected Arduino boards and serial connections.

### Live Telemetry
Real-time data visualization with interactive charts. Supports custom sensor schemas and drag-and-drop chart management.

### Arduino Flash
Interface for uploading firmware to connected Arduino devices. Requires arduino-cli on the backend.

## Environment Variables

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

## WebSocket Connection

The client automatically:
- Connects to the backend WebSocket server on launch
- Reconnects on disconnection (up to 10 attempts with exponential backoff)
- Monitors connection health with heartbeat (65-second timeout)
- Subscribes/unsubscribes from device telemetry on demand

## Troubleshooting

**WebSocket connection fails:**
- Verify backend server is running
- Check `VITE_WS_URL` environment variable
- Ensure CORS is configured correctly on backend
- Check browser console for connection errors

**Authentication issues:**
- Clear browser localStorage
- Re-login with correct credentials
- Check that backend auth service is accessible

**Telemetry not updating:**
- Verify device is subscribed in websocket.ts
- Check sensor mappings in `src/config/sensor-mappings.json`
- Monitor browser Network tab for WebSocket messages

## Development

### Creating New Pages
1. Create component in `src/pages/`
2. Add route in `src/App.tsx`
3. Add navigation link in `src/components/layout/MainLayout.tsx`

### Adding API Endpoints
1. Define request/response types in `src/types/`
2. Add service methods in `src/services/api.ts`
3. Use in component with `useEffect` and error handling

### Styling
- Uses Tailwind CSS with custom configuration
- Component library built on Radix UI
- Icons from Lucide React

## Dependencies

- **React 18** - UI library
- **Vite** - Build tool
- **TypeScript** - Type safety
- **React Router** - Client-side routing
- **Zustand** - State management
- **Axios** - HTTP client
- **TanStack Query** - Data fetching (optional)
- **Tailwind CSS** - Styling
- **Radix UI** - Component primitives
- **Recharts** - Data visualization
- **Lucide React** - Icons

## Deployment

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm run preview
```

Deploy the `dist/` directory to your web server:
- **Static hosting** (GitHub Pages, Netlify, Vercel)
- **Docker** - Create Dockerfile with Node and Nginx
- **Same server** - Serve alongside FastAPI backend

### Example Nginx Configuration
```nginx
server {
    listen 80;
    root /var/www/hyperloop-web-client/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api {
        proxy_pass http://localhost:8000;
    }
}
```

## Testing

```bash
npm run test
```

Runs TypeScript type checking and ESLint validation.

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Create a feature branch
2. Make changes and test locally
3. Run type checking and linting
4. Submit pull request

## License

See main README in repository root.
