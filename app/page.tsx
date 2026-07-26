import BriefPanel from '@/components/BriefPanel';
import VoiceSession from '@/components/VoiceSession';
import FabricPicker from '@/components/FabricPicker';
import SketchPicker from '@/components/SketchPicker';
import PreviewCard from '@/components/PreviewCard';

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center bg-cream-100">
      {/* pb-32 keeps the floating call button clear of the last section's actions */}
      <main className="flex flex-1 w-full max-w-2xl flex-col gap-8 px-5 py-10 pb-32 sm:px-8">
        <header className="text-center flex flex-col items-center gap-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-maroon-900">
            Diya
          </h1>
          <p className="text-sm sm:text-base text-maroon-800/70 max-w-md">
            Speak your design. Diya, your DIY Outfit designer, brings it to life.
          </p>
        </header>

        <BriefPanel />

        <SketchPicker />

        <FabricPicker />

        <PreviewCard />

        <footer className="text-center text-[11px] text-maroon-950/30 pt-4">
          DIYO — custom women&apos;s western wear, designed with you.
        </footer>
      </main>

      {/* Floating: Talk-to-Diya call button + conversation panel (fixed, bottom-right) */}
      <VoiceSession />
    </div>
  );
}
