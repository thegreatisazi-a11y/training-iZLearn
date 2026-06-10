import { ReactNode } from 'react';
import { Table, THead, TBody, TR, TH, TD } from '../ui/table';
import { PageLoader } from '../ui/spinner';
import { EmptyState } from './EmptyState';
import { Button } from '../ui/button';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  loading,
  page = 1,
  pageSize = 50,
  total = 0,
  onPageChange,
  emptyText,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (p: number) => void;
  emptyText?: string;
}) {
  if (loading) return <PageLoader />;
  if (!rows.length) return <EmptyState message={emptyText} />;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="iz-card overflow-hidden">
      <Table>
        <THead>
          <TR>
            {columns.map((c) => (
              <TH key={c.key} className={c.className}>
                {c.header}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <TR key={r.id ?? i}>
              {columns.map((c) => (
                <TD key={c.key} className={c.className}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      {onPageChange && total > pageSize && (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
          <span>
            Page {page} of {totalPages} · {total} records
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Prev
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
