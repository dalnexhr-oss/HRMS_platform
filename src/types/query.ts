export interface QueryError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface QueryResult<T> {
  data: T;
  error: QueryError | null;
  count?: number | null;
}
