/**
 * Custom kanban columns per list, pure. Smart lists (Today, Next
 * 7 Days, tags…) keep date groups; a real list's board shows its own columns.
 */
import type { KanbanColumn, List, Task } from './types';

export const DEFAULT_COLUMNS: KanbanColumn[] = [{ id: 'todo', name: 'To do' }, { id: 'doing', name: 'In progress' }];

export const columnsOf = (l: List | undefined): KanbanColumn[] => (l?.columns?.length ? l.columns : DEFAULT_COLUMNS);

/**
 * Open tasks per column, in column order. A task without a column, or whose
 * column was deleted, sits in the first one.
 */
export function byColumn(cols: KanbanColumn[], tasks: Task[]): { col: KanbanColumn; tasks: Task[] }[] {
  const out = cols.map(col => ({ col, tasks: [] as Task[] }));
  const at = new Map(cols.map((c, i) => [c.id, i]));
  for (const t of tasks) if (!t.done) out[at.get(t.col || '') ?? 0]!.tasks.push(t);
  return out;
}

/** Move a column one place left (-1) or right (+1). */
export function moveColumn(cols: KanbanColumn[], id: string, dir: -1 | 1): KanbanColumn[] {
  const i = cols.findIndex(c => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return cols;
  const out = [...cols]; [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
