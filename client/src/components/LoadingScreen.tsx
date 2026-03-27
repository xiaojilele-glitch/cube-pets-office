import { useI18n } from '@/i18n';
import { useAppStore } from '@/lib/store';

export function LoadingScreen() {
  const loadingProgress = useAppStore(state => state.loadingProgress);
  const { copy } = useI18n();

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-[#FFF8F0] via-[#FFF5EC] to-[#F0E8E0] px-6 text-center">
      <div className="relative mb-8">
        <div
          className="relative h-20 w-20 rounded-3xl bg-gradient-to-br from-[#D4A57A] to-[#C4956A] shadow-lg"
          style={{ animation: 'petBounce 1.2s ease-in-out infinite' }}
        >
          <div className="absolute left-4 top-6 h-3 w-2.5 rounded-full bg-white" />
          <div className="absolute right-4 top-6 h-3 w-2.5 rounded-full bg-white" />
          <div
            className="absolute left-5 top-7 h-1.5 w-1.5 rounded-full bg-[#3A2A1A]"
            style={{ animation: 'lookAround 3s ease-in-out infinite' }}
          />
          <div
            className="absolute right-5 top-7 h-1.5 w-1.5 rounded-full bg-[#3A2A1A]"
            style={{ animation: 'lookAround 3s ease-in-out infinite' }}
          />
          <div className="absolute bottom-4 left-1/2 h-1.5 w-3 -translate-x-1/2 rounded-b-full border-b-2 border-[#3A2A1A]" />
          <div className="absolute -top-2.5 left-2 h-4 w-4 rotate-[-15deg] rounded-tl-xl rounded-tr-sm bg-[#D4A57A]" />
          <div className="absolute -top-2.5 right-2 h-4 w-4 rotate-[15deg] rounded-tl-sm rounded-tr-xl bg-[#D4A57A]" />
        </div>

        <div
          className="mx-auto mt-2 h-3 w-16 rounded-full bg-[#D4B896]/30"
          style={{ animation: 'shadowPulse 1.2s ease-in-out infinite' }}
        />
      </div>

      <h2
        className="mb-2 text-xl font-bold text-[#3A2A1A]"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {copy.loading.title}
      </h2>
      <p className="mb-6 text-sm text-[#8B7355]">
        {copy.loading.description(Math.round(loadingProgress))}
      </p>

      <div className="h-2 w-56 overflow-hidden rounded-full bg-[#E8DDD0]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#C4956A] to-[#D4845A] transition-all duration-300 ease-out"
          style={{ width: `${loadingProgress}%` }}
        />
      </div>

      <style>{`
        @keyframes petBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes shadowPulse {
          0%, 100% { transform: scaleX(1); opacity: 0.3; }
          50% { transform: scaleX(0.7); opacity: 0.15; }
        }
        @keyframes lookAround {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(2px); }
          75% { transform: translateX(-2px); }
        }
      `}</style>
    </div>
  );
}
