import { Button } from '@/app/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function IntegrationSection() {
  const integrations = [
    { name: 'GitHub', color: 'bg-gray-700' },
    { name: 'GitLab', color: 'bg-orange-600' },
    { name: 'Jenkins', color: 'bg-red-600' },
    { name: 'Slack', color: 'bg-purple-600' },
    { name: 'Azure', color: 'bg-blue-600' },
    { name: 'AWS', color: 'bg-orange-500' },
    { name: 'Jira', color: 'bg-blue-700' },
    { name: 'DataDog', color: 'bg-purple-700' },
  ];

  return (
    <section className="bg-gradient-to-br from-[#2C1810] to-[#1a0f0a] py-20">
      <div className="container mx-auto px-6">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="text-4xl font-bold text-white mb-4">
            Streamline-ready for modern API integrations
          </h2>
          <p className="text-gray-300 text-lg mb-2">
            Connect Assistant to your favorite tools and services to automate your API workflows.
          </p>
          <p className="text-gray-300 text-lg">
            With 50+ integrations, you can integrate Assistant into virtually any development or monitoring workflow.
          </p>
        </div>

        {/* Integration icons */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-6 mb-12 max-w-4xl mx-auto">
          {integrations.map((integration, index) => (
            <div key={index} className="flex flex-col items-center">
              <div className={`w-16 h-16 rounded-lg ${integration.color} flex items-center justify-center mb-2 shadow-lg`}>
                <span className="text-white text-xs font-bold">{integration.name.slice(0, 2)}</span>
              </div>
              <span className="text-white text-xs text-center">{integration.name}</span>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Button className="bg-[#FF6C37] hover:bg-[#FF5722] text-white">
            Browse integrations
          </Button>
        </div>
      </div>
    </section>
  );
}
