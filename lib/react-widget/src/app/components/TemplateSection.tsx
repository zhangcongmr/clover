import { ChevronRight } from 'lucide-react';
import { TemplateCard } from './TemplateCard';

interface Template {
  id: string;
  title: string;
  image: string;
  isPPT?: boolean;
  isFavorited?: boolean;
}

interface TemplateSectionProps {
  title: string;
  subtitle?: string;
  templates: Template[];
  tags?: string[];
  baseHref?: string;
}

export function TemplateSection({ title, subtitle, templates, tags, baseHref }: TemplateSectionProps) {
  return (
    <section className="mb-8">
      {/* Section header */}
      <div className="mb-4">
        <h2 className="text-lg mb-2">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        {tags && (
          <div className="flex flex-wrap gap-3 mt-3">
            {tags.map((tag, index) => (
              <button
                key={index}
                className={`text-sm px-3 py-1 rounded ${
                  index === 0
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tag}
              </button>
            ))}
            <button className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 ml-auto">
              查看更多
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            title={template.title}
            image={baseHref + template.image}
            isPPT={template.isPPT}
            isFavorited={template.isFavorited}
          />
        ))}
      </div>
    </section>
  );
}
