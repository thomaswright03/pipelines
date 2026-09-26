import PipelineSubnav from "@/components/PipelineSubnav";

export default function DataleadsellLayout({ children }: LayoutProps<"/dataleadsell">) {
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PipelineSubnav basePath="/dataleadsell" label="dataleadsell.com" />
      {children}
    </div>
  );
}
