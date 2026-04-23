import { useEffect, useState, useCallback } from 'react';
import { useHubStore } from '@/stores/hubStore';
import { hubsApi } from '@/services/api';
import { webSocketService } from '@/services/websocket';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { CommandButton } from '@/components/ui/CommandButton';
import { Layers, Radio, CheckSquare, XSquare, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import type { PortInfo, ConnectionInfo } from '@/types';

interface HubWithDevices {
  hubId: string;
  connected: boolean;
  ports: PortInfo[];
  connections: ConnectionInfo[];
  isExpanded: boolean;
}

const INACTIVE_TIMEOUT_MS = 60 * 1000; // 1 minute

export function DeviceManager() {
  const { hubs = [], fetchHubs, activeSubscriptions, addSubscription, removeSubscription, selectedDevices, toggleDeviceSelection, clearDeviceSelection } = useHubStore();
  const [hubsWithDevices, setHubsWithDevices] = useState<HubWithDevices[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set());
  const [sessionActivity, setSessionActivity] = useState<Map<string, { bytesRead: number; bytesWritten: number; lastActive: number }>>(new Map());
  const [, forceUpdate] = useState(0);

  // Fetch hubs on mount
  useEffect(() => {
    fetchHubs();
  }, [fetchHubs]);

  // Fetch hub ports and connections
  const fetchDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const now = Date.now();
      const updatedActivity = new Map(sessionActivity);
      const seenActivityKeys: Set<string> = new Set();
      const hubsData = await Promise.all(
        hubs.map(async (hub) => {
          try {
            const [portsRaw, connectionsRaw] = await Promise.all([
              hubsApi.getPorts(hub.hubId),
              hubsApi.getConnections(hub.hubId),
            ]);
            // Deduplicate ports by port_id, keeping the last occurrence
            const portsMap = new Map();
            for (const port of portsRaw) {
              portsMap.set(port.port_id, port);
            }
            const ports = Array.from(portsMap.values());
            // Track activity per session and filter inactive ones
            const connections: ConnectionInfo[] = [];
            for (const conn of connectionsRaw as ConnectionInfo[]) {
              const activityKey = `${hub.hubId}:${conn.port_id}:${conn.session_id}`;
              seenActivityKeys.add(activityKey);
              const prev = updatedActivity.get(activityKey);
              if (!prev) {
                updatedActivity.set(activityKey, {
                  bytesRead: conn.bytes_read,
                  bytesWritten: conn.bytes_written,
                  lastActive: now,
                });
                connections.push(conn);
              } else {
                const changed =
                  prev.bytesRead !== conn.bytes_read ||
                  prev.bytesWritten !== conn.bytes_written;
                const lastActive = changed ? now : prev.lastActive;
                updatedActivity.set(activityKey, {
                  bytesRead: conn.bytes_read,
                  bytesWritten: conn.bytes_written,
                  lastActive,
                });
                if (now - lastActive <= INACTIVE_TIMEOUT_MS) {
                  connections.push(conn);
                } else {
                  // Session inactive: auto-unsubscribe and close connection
                  const isSubbed = activeSubscriptions.some(
                    (s) => s.hubId === hub.hubId && s.portId === conn.port_id
                  );
                  if (isSubbed) {
                    try {
                      webSocketService.unsubscribe(hub.hubId, conn.port_id);
                    } finally {
                      removeSubscription(hub.hubId, conn.port_id);
                    }
                  }
                  // Close the connection on the hub
                  try {
                    await hubsApi.closeConnection(hub.hubId, conn.port_id);
                  } catch (error) {
                    console.error(`Failed to close inactive connection ${hub.hubId}:${conn.port_id}:`, error);
                  }
                }
              }
            }
            // Auto-unsubscribe for ports on this hub with no active connection
            const activePortIds = new Set(connections.map((c) => c.port_id));
            for (const sub of activeSubscriptions) {
              if (sub.hubId === hub.hubId && !activePortIds.has(sub.portId)) {
                try {
                  webSocketService.unsubscribe(hub.hubId, sub.portId);
                } finally {
                  removeSubscription(hub.hubId, sub.portId);
                }
              }
            }

            return {
              hubId: hub.hubId,
              connected: hub.connected,
              ports,
              connections,
              isExpanded: expandedHubs.has(hub.hubId),
            };
          } catch (error) {
            console.error(`Failed to fetch devices for hub ${hub.hubId}:`, error);
            return {
              hubId: hub.hubId,
              connected: hub.connected,
              ports: [],
              connections: [],
              isExpanded: expandedHubs.has(hub.hubId),
            };
          }
        })
      );
      setHubsWithDevices(hubsData);
      // Prune activity entries that weren't seen this cycle
      for (const key of Array.from(updatedActivity.keys())) {
        if (!seenActivityKeys.has(key)) {
          updatedActivity.delete(key);
        }
      }
      setSessionActivity(updatedActivity);
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeSubscriptions, expandedHubs, hubs, sessionActivity, removeSubscription]);

  useEffect(() => {
    if (hubs.length > 0) {
      fetchDevices();
    }
  }, [hubs, fetchDevices]);

  // Auto-refresh devices every 10 seconds to detect disconnections
  useEffect(() => {
    if (hubs.length > 0) {
      const interval = setInterval(() => {
        fetchDevices();
      }, 10000); // 10 seconds
      
      return () => clearInterval(interval);
    }
  }, [hubs, fetchDevices]);

  // Force re-render every second to update countdown timers
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  const toggleHubExpansion = (hubId: string) => {
    setExpandedHubs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(hubId)) {
        newSet.delete(hubId);
      } else {
        newSet.add(hubId);
      }
      return newSet;
    });
  };

  const isDeviceSelected = (hubId: string, portId: string): boolean => {
    return selectedDevices.has(`${hubId}:${portId}`);
  };

  const getConnectionStatus = (hubId: string, portId: string): ConnectionInfo | undefined => {
    const hub = hubsWithDevices.find((h) => h.hubId === hubId);
    return hub?.connections.find((c) => c.port_id === portId);
  };

  const isSubscribed = (hubId: string, portId: string): boolean => {
    return activeSubscriptions.some((s) => s.hubId === hubId && s.portId === portId);
  };

  const getTimeRemaining = (hubId: string, portId: string, sessionId: string): number | null => {
    const activityKey = `${hubId}:${portId}:${sessionId}`;
    const activity = sessionActivity.get(activityKey);
    if (!activity) return null;
    const elapsed = Date.now() - activity.lastActive;
    const remaining = INACTIVE_TIMEOUT_MS - elapsed;
    return remaining > 0 ? remaining : 0;
  };

  const handleSubscribeSelected = async () => {
    const devices = Array.from(selectedDevices).map((key) => {
      const [hubId, portId] = key.split(':');
      return { hubId, portId };
    });

    for (const { hubId, portId } of devices) {
      if (!isSubscribed(hubId, portId)) {
        webSocketService.subscribe(hubId, portId);
        addSubscription({
          hubId,
          portId,
          subscribedAt: new Date().toISOString(),
        });
      }
    }

    clearDeviceSelection();
  };

  const handleUnsubscribe = (hubId: string, portId: string) => {
    webSocketService.unsubscribe(hubId, portId);
    removeSubscription(hubId, portId);
  };

  const selectedCount = selectedDevices.size;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-cyan-400">Device Manager</h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Manage device connections and telemetry subscriptions
        </p>
      </div>

      {/* Action Bar */}
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {selectedCount} device{selectedCount !== 1 ? 's' : ''} selected
                </span>
              </div>
              {selectedCount > 0 && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button onClick={handleSubscribeSelected} size="sm" className="w-full sm:w-auto">
                    <Radio className="mr-2 h-4 w-4" />
                    Subscribe to Selected
                  </Button>
                  <Button onClick={clearDeviceSelection} variant="outline" size="sm" className="w-full sm:w-auto">
                    <XSquare className="mr-2 h-4 w-4" />
                    Clear Selection
                  </Button>
                </div>
              )}
            </div>
            <Button onClick={fetchDevices} variant="outline" size="sm" disabled={isLoading} className="w-full sm:w-auto">
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hub Tree */}
      <div className="grid gap-4">
        {hubsWithDevices.map((hub) => (
          <Card key={hub.hubId}>
            <CardHeader
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => toggleHubExpansion(hub.hubId)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
                <div className="flex items-center gap-3">
                  <Layers className="h-4 w-4 sm:h-5 sm:w-5" />
                  <div>
                    <CardTitle className="text-base sm:text-lg">{hub.hubId}</CardTitle>
                    <CardDescription className="text-sm">
                      {hub.ports.length} port{hub.ports.length !== 1 ? 's' : ''} •{' '}
                      {hub.connections.length} active connection{hub.connections.length !== 1 ? 's' : ''}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-center">
                  {hub.connected ? (
                    <Badge variant="default" className="bg-green-500">
                      <Wifi className="mr-1 h-3 w-3" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <WifiOff className="mr-1 h-3 w-3" />
                      Disconnected
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {expandedHubs.has(hub.hubId) && (
              <CardContent className="space-y-2">
                {hub.ports.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <AlertCircle className="h-4 w-4" />
                    <span>No devices detected on this hub</span>
                  </div>
                ) : (
                  hub.ports.map((port) => {
                    const connection = getConnectionStatus(hub.hubId, port.port_id);
                    const subscribed = isSubscribed(hub.hubId, port.port_id);
                    const selected = isDeviceSelected(hub.hubId, port.port_id);

                    return (
                      <div
                        key={port.port_id}
                        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 p-3 border rounded-lg hover:bg-accent/30 transition-colors cursor-pointer`}
                        onClick={(e) => {
                          // Prevent toggling when clicking a button or checkbox
                          if (
                            e.target instanceof HTMLElement &&
                            (e.target.closest('button') || e.target.closest('input[type="checkbox"]'))
                          ) {
                            return;
                          }
                          if (!subscribed) {
                            toggleDeviceSelection(hub.hubId, port.port_id);
                          }
                        }}
                      >
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="mt-1 flex-shrink-0">
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => toggleDeviceSelection(hub.hubId, port.port_id)}
                              disabled={subscribed}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{port.port}</span>
                              {connection && (
                                <Badge variant="outline" className="text-xs">
                                  {connection.baud_rate} baud
                                </Badge>
                              )}
                              {connection && (() => {
                                const timeRemaining = getTimeRemaining(hub.hubId, port.port_id, connection.session_id);
                                if (timeRemaining !== null && timeRemaining <= 30000) {
                                  const seconds = Math.ceil(timeRemaining / 1000);
                                  return (
                                    <Badge variant="outline" className="text-xs bg-yellow-500/20 text-yellow-600 border-yellow-500">
                                      Inactive: {seconds}s
                                    </Badge>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {port.description || port.manufacturer || 'Unknown device'}
                              {port.serial_number && ` • SN: ${port.serial_number}`}
                            </div>
                            {connection && (
                              <div className="text-xs text-muted-foreground mt-1">
                                Session: {connection.session_id.slice(0, 8)}... • ↓ {connection.bytes_read} bytes • ↑ {connection.bytes_written} bytes
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:ml-4">
                          {subscribed ? (
                            <>
                              <Badge className="bg-blue-500">
                                <Radio className="mr-1 h-3 w-3" />
                                Subscribed
                              </Badge>
                              {connection && (
                                <CommandButton
                                  hubId={hub.hubId}
                                  portId={port.port_id}
                                  commandType="restart"
                                  variant="outline"
                                  size="sm"
                                />
                              )}
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnsubscribe(hub.hubId, port.port_id);
                                }}
                                variant="outline"
                                size="sm"
                              >
                                Unsubscribe
                              </Button>
                            </>
                          ) : (
                            <>
                              {webSocketService.hasPendingSubscription(hub.hubId, port.port_id) ? (
                                <Badge className="bg-yellow-400 mr-2">Pending</Badge>
                              ) : null}

                              {connection && (
                                <CommandButton
                                  hubId={hub.hubId}
                                  portId={port.port_id}
                                  commandType="restart"
                                  variant="ghost"
                                  size="sm"
                                />
                              )}

                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  webSocketService.subscribe(hub.hubId, port.port_id);
                                  addSubscription({
                                    hubId: hub.hubId,
                                    portId: port.port_id,
                                    subscribedAt: new Date().toISOString(),
                                  });
                                }}
                                variant="default"
                                size="sm"
                              >
                                <Radio className="mr-2 h-4 w-4" />
                                Subscribe
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Active Subscriptions */}
      {activeSubscriptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Subscriptions</CardTitle>
            <CardDescription>
              {activeSubscriptions.length} active telemetry stream{activeSubscriptions.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activeSubscriptions.map((sub) => {
                return (
                  <div
                    key={`${sub.hubId}:${sub.portId}`}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Radio className="h-4 w-4 text-blue-500" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {sub.hubId} → {sub.portId}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Subscribed at {new Date(sub.subscribedAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleUnsubscribe(sub.hubId, sub.portId)}
                      variant="ghost"
                      size="sm"
                    >
                      Unsubscribe
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {hubsWithDevices.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Hubs Connected</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Connect a Raspberry Pi hub to start managing devices and viewing telemetry data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
