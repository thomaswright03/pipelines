import PipelineSubnav from "@/components/PipelineSubnav";

export default function ColdOutreachLayout({ children }: LayoutProps<"/vault-pipeline">) {
  return (
    <div className="flex flex-col gap-5">
      <PipelineSubnav basePath="/vault-pipeline" label="Cold Outreach" />
      {children}
    </div>
  );
}
