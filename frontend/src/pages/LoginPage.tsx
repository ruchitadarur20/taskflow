import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Input";
import { ErrorNotice } from "../components/data/QueryBoundary";

export function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login({ email, password });
      toast({ title: "Welcome back", variant: "success" });
      navigate(from, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Sign in failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthPageShell
      heading="Sign in"
      footer={
        <>
          New to TaskFlow?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field label="Email" htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error ? <ErrorNotice message={error} /> : null}
        <Button type="submit" isLoading={isLoading} className="w-full justify-center">
          Sign in
        </Button>
      </form>
    </AuthPageShell>
  );
}

export function AuthPageShell({
  heading,
  children,
  footer,
}: {
  heading: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">TaskFlow</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">{heading}</h1>
        <div className="mt-5">{children}</div>
        {footer ? <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p> : null}
      </div>
    </div>
  );
}
