import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { Search, Home } from 'lucide-react';
import { ApiEndpoint, ApiGroup } from '@/app/components/ApiEndpoint';

interface Parameter {
  name: string;
  type: string;
  description: string;
  example?: string;
}

const mockParameters: Parameter[] = [
  {
    name: 'query',
    type: 'string',
    description: 'Determines a point in time from which tier should be fetched. Either a specific ISO 8601 datetime or a relative identifier such as "-30d" (for past 30 days).',
    example: 'now'
  },
  {
    name: 'query',
    type: 'string',
    description: 'Determines a point in time from which tier should be fetched. Either a specific ISO 8601 datetime or a relative identifier such as "-30d" (for past 30 days).',
    example: 'now'
  },
  {
    name: 'count',
    type: 'integer',
    description: 'The amount of items on each page.',
    example: '50'
  }
];

export function ApiTester() {
  const [activeEndpoint, setActiveEndpoint] = useState('/public/v1/logs');
  const [selectedTab, setSelectedTab] = useState('parameters');

  return (
    <div className="flex h-screen bg-white">
      {/* Left Sidebar */}
      <div className="w-64 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium text-gray-700">Editor</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search..."
              className="pl-10 h-8 text-sm"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="py-2">
            <ApiGroup label="public/v1" defaultOpen={true}>
              <ApiGroup method="GET" path="/public/v1/content-library-items/{id}/details" level={1} />
              <ApiGroup method="GET" path="/public/v1/templates" level={1} defaultOpen={true}>
                <ApiEndpoint method="GET" path="/public/v1/templates" level={2} />
                <ApiEndpoint method="POST" path="/public/v1/templates/{id}/upload" level={2} />
                <ApiEndpoint method="GET" path="/public/v1/templates/id/details" level={2} />
                <ApiEndpoint method="DELETE" path="/public/v1/templates/{id}" level={2} />
                <ApiEndpoint method="PATCH" path="/public/v1/templates/{id}" level={2} />
              </ApiGroup>
              <ApiGroup method="GET" path="/public/v1/forms" level={1} />
              <ApiGroup method="GET" path="/public/v1/logs/dil" level={1} />
              <ApiGroup method="GET" path="/public/v1/contacts" level={1} />
              <ApiEndpoint 
                method="GET" 
                path="/public/v1/contacts/{id}" 
                level={1}
                isActive={activeEndpoint === '/public/v1/logs'}
                onClick={() => setActiveEndpoint('/public/v1/logs')}
              />
              <ApiEndpoint method="DELETE" path="/public/v1/contacts/{id}" level={1} />
              <ApiEndpoint method="PATCH" path="/public/v1/contacts/{id}" level={1} />
              <ApiGroup method="GET" path="/public/v1/members" level={1} />
              <ApiGroup method="GET" path="/public/v1/webhook-subscriptions" level={1}>
                <ApiEndpoint method="GET" path="/public/v1/webhook-subscriptions" level={2} />
                <ApiEndpoint method="POST" path="/public/v1/webhook-subscriptions" level={2} />
                <ApiEndpoint method="GET" path="/public/v1/webhook-subscriptions/{id}" level={2} />
                <ApiEndpoint method="DELETE" path="/public/v1/webhook-subscriptions/{id}" level={2} />
                <ApiEndpoint method="PATCH" path="/public/v1/webhook-subscriptions/{id}/channel-key" level={2} />
              </ApiGroup>
            </ApiGroup>
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-gray-200 text-xs text-gray-600">
          File type
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">GET</span>
            <Input 
              value="https://api.pandadoc.com/public/v1/logs"
              className="w-96 h-8 text-sm font-mono"
              readOnly
            />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="text-sm text-gray-600 hover:text-gray-900">
              <Home className="w-4 h-4 mr-1" />
              Home
            </Button>
            <Button className="h-8 px-4 text-sm">Send</Button>
          </div>
        </div>

        {/* Request Tabs */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex-1 flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b border-gray-200 bg-transparent px-6 h-12">
            <TabsTrigger value="parameters" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
              Parameters
            </TabsTrigger>
            <TabsTrigger value="headers" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
              Headers
            </TabsTrigger>
            <TabsTrigger value="auth" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
              Auth
            </TabsTrigger>
            <TabsTrigger value="body" className="rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
              Body
            </TabsTrigger>
          </TabsList>

          <TabsContent value="parameters" className="flex-1 m-0">
            <ScrollArea className="h-full">
              <div className="p-6">
                {mockParameters.map((param, index) => (
                  <div key={index} className="mb-6 pb-6 border-b border-gray-200 last:border-0">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-mono text-sm font-medium text-gray-900">{param.name}:</span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <span className="text-xs text-gray-500">query</span>
                          </div>
                          <div className="text-sm text-gray-700">
                            <span className="font-medium">description:</span> {param.description}
                          </div>
                          {param.example && (
                            <div className="text-sm text-gray-700">
                              <span className="font-medium">example:</span> {param.example}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="headers" className="flex-1 m-0 p-6">
            <div className="text-sm text-gray-500">Headers configuration</div>
          </TabsContent>

          <TabsContent value="auth" className="flex-1 m-0 p-6">
            <div className="text-sm text-gray-500">Authentication settings</div>
          </TabsContent>

          <TabsContent value="body" className="flex-1 m-0 p-6">
            <div className="text-sm text-gray-500">Body</div>
          </TabsContent>
        </Tabs>

        {/* Bottom Bar */}
        <div className="flex items-center justify-between px-6 py-2 border-t border-gray-200">
          <div className="text-xs text-gray-600">Status</div>
          <div className="text-xs text-gray-600">Setup Time: 0</div>
        </div>
      </div>
    </div>
  );
}
