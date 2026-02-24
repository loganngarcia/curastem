import { useState } from "react";
import { Maximize2, X } from "lucide-react";

interface ImageGalleryProps {
  images: Array<{ url: string; alt: string }>;
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (images.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 mt-4">
      {images.map((img, i) => (
        <div 
          key={i} 
          className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 group cursor-pointer"
          onClick={() => setSelectedImage(img.url)}
        >
          <img 
            src={img.url} 
            alt={img.alt} 
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Maximize2 className="text-white h-5 w-5" />
          </div>
        </div>
      ))}

      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedImage(null)}
        >
          <button className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full">
            <X className="h-6 w-6" />
          </button>
          <img 
            src={selectedImage} 
            alt="Enlarged view" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
