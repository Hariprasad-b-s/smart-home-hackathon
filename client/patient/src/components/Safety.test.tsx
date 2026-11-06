// @vitest-environment jsdom
import '../test/setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AiStatusChip, SafetyBanner } from './Safety';

describe('SafetyBanner', () => {
  it('emergency: big card with Call 911, plus 988 call/text when mentioned', () => {
    render(<SafetyBanner notice={{ level: 'emergency', message: 'Please call or text 988 now, or call 911 if you are in danger.' }} />);
    expect(screen.getByRole('alert', { name: 'Emergency' })).toHaveTextContent('Get help now');
    expect(screen.getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
    expect(screen.getByRole('link', { name: 'Call 988' })).toHaveAttribute('href', 'tel:988');
    expect(screen.getByRole('link', { name: 'Text 988' })).toHaveAttribute('href', 'sms:988');
  });

  it('urgent without phone numbers shows the message only', () => {
    render(<SafetyBanner notice={{ level: 'urgent', message: 'Follow the yellow zone of your plan.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Follow the yellow zone of your plan.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('AiStatusChip', () => {
  it('labels the engine and shows the notice in a popover', () => {
    const { rerender } = render(<AiStatusChip status={{ engine: 'claude', model: 'claude-opus-5-5', notice: 'Demo only, synthetic data.' }} />);
    const chip = screen.getByRole('button', { name: /AI helper \(demo\)/ });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent('Demo only, synthetic data.');
    rerender(<AiStatusChip status={{ engine: 'rules', notice: 'Demo only.' }} />);
    expect(screen.getByRole('button', { name: /Offline helper/ })).toBeInTheDocument();
  });
});
