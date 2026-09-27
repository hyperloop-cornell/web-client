import { useEffect, useState } from 'react';
import { useHubStore } from '@/stores/hubStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RadioTower, Search, Server, Wifi, WifiOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { hubFlashFormats } from '@/config/boards';
import type { HubHealth, HubInfo } from '@/types';

function uplinkOf(hub: HubInfo, health: HubHealth | undefined): string | null {
  const live = health?.uplink;
  if (live && !live.stale && typeof live.active === 'string') return live.active;
  return hub.profile?.uplink ?? null;
}

export function Dashboard() {
  const { hubs = [], fetchHubs, isLoading, health } = useHubStore();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchHubs();
    // Refresh every 30 seconds
    const interval = setInterval(fetchHubs, 30000);
    return () => clearInterval(interval);
  }, [fetchHubs]);

  const filteredHubs = hubs.filter((hub) =>
    hub.hubId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-cyan-400">Hub Dashboard</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Monitor and manage your RPi hub connections
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search hubs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 text-foreground"
        />
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hubs</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{hubs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Connected</CardTitle>
            <Wifi className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {hubs.filter((h) => h.connected).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disconnected</CardTitle>
            <WifiOff className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {hubs.filter((h) => !h.connected).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hub List */}
      <div className="space-y-4">
        {isLoading && hubs.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-8 sm:py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Loading hubs...</p>
              </div>
            </CardContent>
          </Card>
        ) : filteredHubs.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-8 sm:py-12">
              <div className="text-center">
                <Server className="h-8 w-8 sm:h-12 sm:w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? 'No hubs found' : 'No hubs configured'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          filteredHubs.map((hub) => {
            const hubHealth = health[hub.hubId];
            const uplink = hub.connected ? uplinkOf(hub, hubHealth) : null;
            const legacy = hub.connected && !hub.profile;
            return (
            <Card key={hub.hubId} className={hub.connected ? '' : 'opacity-70'}>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                      <Server className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                      <span className="truncate">{hub.hubId}</span>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      Version: {hub.version || 'Unknown'}
                      {hub.profile?.name && <> &middot; Profile: {hub.profile.name}</>}
                    </CardDescription>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {uplink === 'cellular' && (
                        <Badge variant="warning" title="Wi-Fi unavailable; hub is using the cellular HAT">
                          <RadioTower className="h-3 w-3 mr-1" />
                          Cellular
                        </Badge>
                      )}
                      {uplink === 'wifi' && (
                        <Badge variant="outline" title="Hub reports it is on Wi-Fi">
                          <Wifi className="h-3 w-3 mr-1" />
                          Wi-Fi
                        </Badge>
                      )}
                      {legacy && (
                        <Badge variant="outline" title="Older rpi-hub-server: .ino/.hex flashing only; update to get board detection">
                          Older hub software
                        </Badge>
                      )}
                      {hub.connected && (
                        <Badge variant="secondary" title="Firmware formats this hub can flash">
                          Flash: {hubFlashFormats(hub.capabilities).map((f) => `.${f}`).join(' ')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Badge variant={hub.connected ? 'success' : 'destructive'} className="self-start">
                    {hub.connected ? (
                      <>
                        <Wifi className="h-3 w-3 mr-1" />
                        Connected
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-3 w-3 mr-1" />
                        Disconnected
                      </>
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 text-sm">
                  {hub.connected && hub.connectedAt && (
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                      <span className="text-muted-foreground font-medium">Connected:</span>
                      <span className="sm:text-right">
                        {formatDistanceToNow(new Date(hub.connectedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  )}
                  {hub.lastSeen ? (
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                      <span className="text-muted-foreground font-medium">Last Seen:</span>
                      <span className="sm:text-right">
                        {formatDistanceToNow(new Date(hub.lastSeen), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  ) : (
                    !hub.connected && (
                      <div className="text-muted-foreground">Not seen since the cloud service started</div>
                    )
                  )}
                  {hub.connected && hubHealth && (
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0">
                      <span className="text-muted-foreground font-medium">Health:</span>
                      <span className="sm:text-right">
                        CPU {hubHealth.cpu_percent ?? '-'}% &middot; Memory {hubHealth.memory_percent ?? '-'}% &middot; Disk{' '}
                        {hubHealth.disk_percent ?? '-'}%
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
