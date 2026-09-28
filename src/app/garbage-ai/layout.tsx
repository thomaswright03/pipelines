import PipelineSubnav from "@/components/PipelineSubnav";

export default function GarbageAiLayout({ children }: LayoutProps<"/garbage-ai">) {
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PipelineSubnav basePath="/garbage-ai" label="Garbage AI" />
      {children}
    </div>
  );
}
