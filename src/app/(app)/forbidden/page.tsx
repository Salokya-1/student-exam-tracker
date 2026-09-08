import { LinkButton, PageHeader } from "@/components/ui";

export default function Forbidden() {
  return (
    <>
      <PageHeader eyebrow="403" title="You do not have access to this area" description="Your role does not permit this action. Contact the RTE Department if you believe this is a mistake." />
      <LinkButton href="/">Back to home</LinkButton>
    </>
  );
}
