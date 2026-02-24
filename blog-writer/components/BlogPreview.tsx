import { BlogItem } from "@/lib/framer";
import { formatDate } from "@/lib/utils";
import { ExternalLink, Calendar, User } from "lucide-react";

interface BlogPreviewProps {
  blog: BlogItem;
}

export function BlogPreview({ blog }: BlogPreviewProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {blog.coverImageUrl && (
        <div className="aspect-video w-full overflow-hidden bg-gray-100">
          <img 
            src={blog.coverImageUrl} 
            alt={blog.title} 
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="p-4 space-y-2">
        <div className="flex items-center space-x-2 text-xs text-gray-400">
          <Calendar className="h-3 w-3" />
          <span>{blog.date ? formatDate(blog.date) : "No date"}</span>
        </div>
        <h3 className="font-bold text-lg leading-tight line-clamp-2">{blog.title}</h3>
        <p className="text-sm text-gray-500 line-clamp-2">{blog.headline}</p>
        <div className="pt-2 flex items-center justify-between">
          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded uppercase font-semibold">
            {blog.slug}
          </span>
          <a 
            href={`https://framer.com/projects/Curastem--Nm2da0FN8dThXzErJuhd?slug=${blog.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-black hover:underline text-xs flex items-center space-x-1 font-medium"
          >
            <span>Open in Framer</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
