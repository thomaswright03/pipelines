import PipelineSubnav from "@/components/PipelineSubnav";

export default function RoomDesignerLayout({ children }: LayoutProps<"/room-designer">) {
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PipelineSubnav basePath="/room-designer" label="Room Designer 3D" />
      {children}
    </div>
  );
}
