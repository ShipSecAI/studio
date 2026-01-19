/// <reference types="bun-types" />

import '@testing-library/jest-dom';

declare module 'bun:test' {
  interface Matchers<T = any> {
    toBeInTheDocument(): T;
    toHaveClass(className: string): T;
    toHaveTextContent(text: string | RegExp): T;
    toBeVisible(): T;
    toBeDisabled(): T;
    toBeEnabled(): T;
    toHaveAttribute(attr: string, value?: string): T;
    toHaveValue(value: string | number): T;
    toBeChecked(): T;
    toHaveFocus(): T;
    toBeEmptyDOMElement(): T;
    toContainElement(element: HTMLElement | null): T;
    toContainHTML(html: string): T;
    toHaveStyle(style: Record<string, string>): T;
    toHaveFormValues(values: Record<string, unknown>): T;
    toHaveDisplayValue(value: string | RegExp | (string | RegExp)[]): T;
    toBePartiallyChecked(): T;
    toHaveDescription(text: string | RegExp): T;
    toHaveRole(role: string, options?: any): T;
    toHaveAccessibleName(name: string | RegExp): T;
    toHaveAccessibleDescription(description: string | RegExp): T;
    toBeInvalid(): T;
    toBeValid(): T;
    toBeRequired(): T;
    toBeOptional(): T;
    toBeReadOnly(): T;
    toHaveErrorMessage(message: string | RegExp): T;
    toBeInTheDOM(): T;
  }
}
