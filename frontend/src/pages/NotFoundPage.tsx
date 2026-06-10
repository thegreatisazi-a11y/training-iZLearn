import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h1 className="text-3xl font-bold text-slate-800">404</h1>
      <p className="text-slate-500">The page you are looking for does not exist.</p>
      <Link to="/" className="text-primary underline">
        Back to dashboard
      </Link>
    </div>
  );
}
