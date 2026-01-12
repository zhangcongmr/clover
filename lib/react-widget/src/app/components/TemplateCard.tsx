import { Heart, FileText } from 'lucide-react';

interface TemplateCardProps {
  title: string;
  image: string;
  isPPT?: boolean;
  isFavorited?: boolean;
}

export function TemplateCard({ title, image, isPPT = false, isFavorited = false }: TemplateCardProps) {
  return (
    <div className="group cursor-pointer">
      <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
        <img src={image} alt={title} className="w-full h-full object-cover" />
        {isFavorited && (
          <div className="absolute top-2 right-2">
            <Heart className="w-4 h-4 text-red-500 fill-red-500" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1">
        {isPPT && <FileText className="w-3 h-3 text-orange-500" />}
        <span className="text-sm text-gray-700 line-clamp-1">{title}</span>
      </div>
    </div>
  );
}
