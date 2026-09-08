"use client";

import { useState } from "react";

const DEMO = [
  { label: "Administrator", email: "admin@islington.edu.np", hint: "Full control · publishes results" },
  { label: "RTE Officer", email: "rte@islington.edu.np", hint: "Timetables, exams, approvals" },
  { label: "Lecturer", email: "lecturer@islington.edu.np", hint: "Marks entry · own workload" },
  { label: "Student", email: "student@islington.edu.np", hint: "Personal timetable, seats, results" },
];

export function LoginForm({ action, error, next }: { action: (fd: FormData) => Promise<void>; error?: string; next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="caps block mb-2" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="caps block mb-2" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-danger text-[13px]">{error}</p>}
      <button className="btn btn-primary w-full" type="submit">
        Sign in
      </button>
      <div className="pt-6">
        <div className="caps mb-3">Demo roles · password Password123</div>
        <div className="grid grid-cols-2 gap-2">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword("Password123");
              }}
              className="text-left border border-hairline-2 hover:border-ink p-3 transition-colors"
            >
              <div className="text-ink text-[13px] font-medium">{d.label}</div>
              <div className="text-muted text-[11px] mt-0.5">{d.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
