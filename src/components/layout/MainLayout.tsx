import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { useHubStore } from '@/stores/hubStore';
import { webSocketService } from '@/services/websocket';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Layers, Activity, LogOut, Zap, Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import loopIcon from '@/assets/loopIcon.png';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showSidebarText, setShowSidebarText] = useState(true);

  const navigation = [
    { name: 'Hub Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Device Manager', href: '/devices', icon: Layers },
    { name: 'Live Telemetry', href: '/telemetry', icon: Activity },
    { name: 'Arduino Flash', href: '/flash', icon: Zap },
  ];

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  // Get active navigation index for sliding indicator
  const activeIndex = navigation.findIndex((item) => isActive(item.href));

  // Delay text visibility to sync with collapse animation (300ms)
  useEffect(() => {
    if (isSidebarCollapsed) {
      // Hide text immediately when collapsing
      setShowSidebarText(false);
    } else {
      // Delay showing text until animation completes when expanding
      const timer = setTimeout(() => {
        setShowSidebarText(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isSidebarCollapsed]);

  // Register web socket telemetry handler
  useEffect(() => {
    const handler = (message: any) => {
      try {
        if (message?.type === 'telemetry_stream') {
          useTelemetryStore.getState().processTelemetry(message as any);
        } else if (message?.type === 'task_status') {
          // Handle task status updates
          const hubStore = useHubStore.getState();
          hubStore.updateTaskStatus({
            task_id: message.task_id,
            status: message.status,
            result: message.result,
            error: message.error,
          });
        } else if (message?.type === 'device_event') {
          // Handle device disconnect events by auto-unsubscribing
          if (message.event === 'disconnected') {
            const hubStore = useHubStore.getState();
            const isSubscribed = hubStore.activeSubscriptions.some(
              (s) => s.hubId === message.hubId && s.portId === message.portId
            );
            if (isSubscribed) {
              console.log(`Device ${message.hubId}:${message.portId} disconnected, removing subscription`);
              webSocketService.unsubscribe(message.hubId, message.portId);
              hubStore.removeSubscription(message.hubId, message.portId);
            }
          }
        }
      } catch (e) {
        // Keep handler robust
        // eslint-disable-next-line no-console
        console.error('Error in WebSocket message handler:', e);
      }
    };

    const unsub = webSocketService.onMessage(handler);
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-50 w-full border-b bg-card">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src={loopIcon} alt="Hub Manager" className="h-8 lg:h-10 w-auto object-contain flex-shrink-0 max-w-none" />
            <span className="text-lg font-semibold text-foreground">Hub Manager</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden text-white hover:text-white"
          >
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </Button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div 
        className={`lg:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isMobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`} 
        onClick={() => setIsMobileMenuOpen(false)} 
      />

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 border-r bg-card shadow-lg transition-[width,transform] duration-300 ease-in-out ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${
        isSidebarCollapsed ? 'w-16' : 'w-64'
      }`}>
        {/* Desktop collapse button - absolutely positioned, visible on hover or when collapsed */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className={`hidden lg:flex absolute top-4 z-20 h-8 w-8 text-white hover:text-white hover:bg-accent transition-all duration-300 ${
            isSidebarCollapsed ? 'left-4' : 'right-3'
          }`}
        >
          {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>

        <div className="flex h-full flex-col overflow-hidden">
          {/* Header */}
          <div className="flex h-16 items-center border-b px-3 bg-background/50">
            <div className={`flex items-center gap-2 transition-all duration-300 ${
              isSidebarCollapsed ? 'justify-center w-full' : 'flex-1 min-w-0'
            }`}>
              <img src={loopIcon} alt="Hub Manager" className="h-8 lg:h-10 w-auto object-contain flex-shrink-0" />
              <span className={`text-lg font-semibold text-foreground whitespace-nowrap transition-opacity duration-200 ${
                showSidebarText ? 'opacity-100' : 'opacity-0'
              }`}>Hub Manager</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-2 relative overflow-hidden">
            {/* Sliding active indicator */}
            <div 
              className={`absolute left-2 h-9 bg-primary rounded-lg shadow-sm transition-all duration-300 ease-out ${
                isSidebarCollapsed ? 'w-12' : 'w-[calc(100%-1rem)]'
              }`}
              style={{ 
                transform: `translateY(${activeIndex * 40}px)`,
                opacity: activeIndex >= 0 ? 1 : 0
              }}
            />
            
            {/* Navigation links */}
            <div className="relative space-y-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const isTelemetry = item.href === '/telemetry';
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                      active
                        ? 'text-primary-foreground'
                        : isTelemetry
                        ? 'text-cyan-400 hover:bg-accent/50 hover:text-cyan-300'
                        : 'text-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                    title={isSidebarCollapsed ? item.name : ''}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className={`whitespace-nowrap transition-opacity duration-200 ${
                      showSidebarText ? 'opacity-100' : 'opacity-0'
                    }`}>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* User Info & Logout */}
          <div className="border-t p-2 bg-background/50">
            <div className={`flex items-center transition-all duration-300 ${
              isSidebarCollapsed ? 'flex-col gap-2' : 'justify-between'
            }`}>
              <div className={`flex items-center gap-3 min-w-0 ${
                isSidebarCollapsed ? 'flex-col' : 'flex-1'
              }`}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium flex-shrink-0">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className={`flex flex-col min-w-0 whitespace-nowrap transition-opacity duration-200 ${
                  showSidebarText ? 'opacity-100' : 'opacity-0'
                }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">{user?.username || 'User'}</span>
                    {user?.role === 'viewer' && (
                      <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded whitespace-nowrap">
                        Viewer
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">Connected</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                title="Logout"
                className="hover:bg-destructive/10 hover:text-destructive transition-colors h-8 w-8 flex-shrink-0 text-white"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`transition-all duration-300 ${
        isSidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'
      } pt-16 lg:pt-0`}>
        <main className="min-h-screen p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
