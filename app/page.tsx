import BriefPanel from '@/components/BriefPanel';
import TalkControl from '@/components/TalkControl';
import TranscriptPane from '@/components/TranscriptPane';
import FabricPicker from '@/components/FabricPicker';
import SketchPicker from '@/components/SketchPicker';
import SummaryCard from '@/components/SummaryCard';

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center bg-cream-100">
      <main className="flex flex-1 w-full max-w-2xl flex-col gap-8 px-5 py-10 sm:px-8">
        <header className="text-center flex flex-col items-center gap-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-maroon-900">
            Bolke Design Karo
          </h1>
          <p className="text-sm sm:text-base text-maroon-800/70 max-w-md">
            Speak your design. Diya, your DIYO designer, brings it to life.
          </p>
        </header>

        <BriefPanel />

        <TalkControl />

        <TranscriptPane />

        <SummaryCard />

        <div className="border-t border-maroon-900/10 pt-6 flex flex-col gap-8">
          <SketchPicker />
          <FabricPicker />
        </div>

        <footer className="text-center text-[11px] text-maroon-950/30 pt-4">
          DIYO — custom women&apos;s western wear, designed with you.
        </footer>
      </main>
    </div>
  );
}
