import { login } from "./actions";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — RTE Hub" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden lg:flex flex-col justify-between p-16 overflow-hidden border-r border-hairline">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(1200px 600px at -10% 110%, rgba(218,41,28,0.28), transparent 60%), radial-gradient(800px 500px at 110% -10%, rgba(255,255,255,0.06), transparent 60%), linear-gradient(180deg,#1c1c1c,#141414)",
          }}
        />
        <div aria-hidden className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="inline-block h-8 w-1.5 bg-rosso" />
            <span className="caps text-ink">Islington College · RTE Department</span>
          </div>
        </div>
        <div className="relative max-w-xl">
          <h1 className="text-[56px] leading-[1.05] tracking-[-1.12px] font-medium text-ink">
            One operational hub for routine, timetable &amp; examinations.
          </h1>
          <p className="mt-6 text-[15px] text-body max-w-md">
            Clash-free timetabling, controlled result publication, automated exam seating and live utilisation analytics — replacing
            disconnected spreadsheets with a single source of truth.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-6">
            {[
              ["6", "hard constraints checked live"],
              ["4", "step result approval chain"],
              ["1", "click seating &amp; invigilators"],
            ].map(([n, l]) => (
              <div key={l} className="border-l border-hairline-2 pl-4">
                <div className="text-[40px] leading-none font-bold text-ink num">{n}</div>
                <div className="caps mt-2" dangerouslySetInnerHTML={{ __html: l }} />
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-[12px] text-muted">Islington Hackathon 2026 · Intelligent Academic Planning + Smarter Systems, Stronger Records</div>
      </section>
      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <span className="inline-block h-6 w-1.5 bg-rosso" />
            <span className="caps text-ink">Islington College · RTE Hub</span>
          </div>
          <h2 className="text-[26px] font-medium">Sign in</h2>
          <p className="mt-1 text-body">Use your college account, or pick a demo role.</p>
          <LoginForm action={login} error={sp.error} next={sp.next} />
        </div>
      </section>
    </main>
  );
}
