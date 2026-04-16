import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { copy } = useI18n();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-[#FFF8F0] via-[#F7F1EA] to-[#E8DDD0] px-4">
      <Card className="mx-4 w-full max-w-lg border-0 bg-white/82 shadow-xl backdrop-blur-sm">
        <CardContent className="pb-8 pt-8 text-center">
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-red-100 animate-pulse" />
              <AlertCircle className="relative h-16 w-16 text-red-500" />
            </div>
          </div>

          <h1 className="mb-2 text-4xl font-bold text-slate-900">404</h1>
          <h2 className="mb-4 text-xl font-semibold text-slate-700">
            {copy.notFound.title}
          </h2>

          <p className="mb-8 leading-relaxed text-slate-600">
            {copy.notFound.description}
          </p>

          <Button
            onClick={() => setLocation("/")}
            className="rounded-lg bg-[#2D5F4A] px-6 py-2.5 text-white shadow-md transition-all duration-200 hover:bg-[#245040] hover:shadow-lg"
          >
            <Home className="mr-2 h-4 w-4" />
            {copy.notFound.button}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
