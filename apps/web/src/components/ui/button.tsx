import type { ButtonHTMLAttributes } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 disabled:pointer-events-none', {
  variants: { variant: { default: 'bg-primary text-primary-foreground hover:bg-primary/90', outline: 'border border-border bg-card hover:bg-muted' } },
  defaultVariants: { variant: 'default' },
});
export function Button({ className, variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' }) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
