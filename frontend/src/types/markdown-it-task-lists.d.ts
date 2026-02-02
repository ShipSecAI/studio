declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';

  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }

  function markdownItTaskLists(md: MarkdownIt, options?: TaskListsOptions): void;

  export = markdownItTaskLists;
}
