
# Real-time Monitoring Dashboard

A professional, modern real-time monitoring dashboard designed for Intrusion Detection Systems (IDS). This application provides comprehensive monitoring, alerting, and analysis capabilities for network security operations.

## Features

- **Real-time Alerts**: Instant notifications and visualization of security alerts
- **Network Flow Analysis**: Detailed inspection and analysis of network flows
- **System Graphs**: Visual representation of system metrics and network activity
- **Log Management**: Comprehensive log aggregation and search capabilities
- **Data Ingestion**: Built-in support for real-time data ingestion
- **Role-based Authentication**: Secure authentication system with session management
- **Dark Theme**: Professional dark mode UI optimized for 24/7 operations
- **Responsive Design**: Works seamlessly on desktop and tablet devices

## Technology Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Component Library**: shadcn/ui (Radix UI primitives + Tailwind CSS)
- **Routing**: React Router v7
- **Charts & Visualization**: Recharts
- **Form Handling**: React Hook Form
- **UI Components**: Extensive collection of accessible, customizable components
- **Notifications**: Sonner for toast notifications
- **Icons**: Lucide React and Material UI Icons

## Getting Started

### Prerequisites

- Node.js 16.x or higher
- npm or yarn package manager

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd real-time-monitoring-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The production-ready build will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── app/
│   ├── components/
│   │   ├── auth/              # Authentication components
│   │   ├── layout/            # Layout components (Sidebar, RootLayout)
│   │   ├── pages/             # Page components (Alerts, Flows, Graph, Logs, Ingestion)
│   │   ├── shared/            # Shared components (ExplanationPanel)
│   │   ├── ui/                # shadcn/ui components and primitives
│   │   └── IDSDashboard.tsx   # Main dashboard component
│   ├── context/               # React Context for state management
│   │   ├── AuthContext.tsx    # Authentication state
│   │   └── SimulationContext.tsx  # Data simulation state
│   ├── types/                 # TypeScript type definitions
│   ├── utils/                 # Utility functions and helpers
│   ├── App.tsx                # Root application component
│   └── routes.tsx             # Route definitions and guards
├── styles/
│   ├── index.css              # Global styles
│   ├── fonts.css              # Font definitions
│   ├── tailwind.css           # Tailwind CSS imports
│   └── theme.css              # Theme variables
└── main.tsx                   # Application entry point
```

## Pages & Features

### Dashboard
Main landing page showing system overview and key metrics.

### Alerts
Real-time alert management and visualization. View, filter, and respond to security alerts as they occur.

### Flows
Network flow analysis and monitoring. Inspect detailed information about network connections and traffic patterns.

### Graph
Visual representation of system metrics and network topology.

### Logs
Comprehensive log management and search. Filter, search, and analyze system and application logs.

### Ingestion
Data ingestion interface for importing metrics and events from external sources.

## Authentication

The application includes a role-based authentication system:
- Secure login page
- Session management via AuthContext
- Protected routes that redirect unauthenticated users to login
- Automatic redirects for authenticated users attempting to access login

## Customization & Development

### Adding New Pages
1. Create a new component in `src/app/components/pages/`
2. Add the route in `src/app/routes.tsx`
3. Add a navigation link in `src/app/components/layout/Sidebar.tsx`

### Styling
- Use Tailwind CSS classes for styling
- Component-specific styles should be co-located with components
- Customize theme tokens in `src/styles/theme.css`

### UI Components
Use the pre-built shadcn/ui components located in `src/app/components/ui/`. These are fully customizable and documented at [shadcn/ui](https://ui.shadcn.com/)

## Contributing

For contributions, please follow these guidelines:
1. Create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Ensure code style consistency
4. Submit a pull request with a detailed description

## License

See [LICENSE](./LICENSE) file for details.

## Attribution

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for third-party libraries and resources used in this project.
  