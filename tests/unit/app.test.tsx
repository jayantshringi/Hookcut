import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';

describe('App', () => {
  it('renders ClipForge header', () => {
    render(<App />);
    expect(screen.getByText('ClipForge')).toBeInTheDocument();
  });
});
