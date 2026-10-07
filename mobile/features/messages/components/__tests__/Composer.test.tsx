import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Composer } from '../Composer';

function setup(onSend = jest.fn(() => true)) {
  const onTyping = jest.fn();
  const onToggleEmoji = jest.fn();
  const view = render(
    <Composer
      onSend={onSend}
      onTyping={onTyping}
      emojiOpen={false}
      onToggleEmoji={onToggleEmoji}
      emptyAction={<Text testID="ping-button">Ping</Text>}
    />,
  );
  return { view, onSend, onTyping, onToggleEmoji };
}

describe('Composer', () => {
  it('shows the Ping button while empty and swaps to Send when there is text', async () => {
    const { view } = setup();
    await view;
    expect(screen.getByTestId('ping-button')).toBeTruthy();
    expect(screen.queryByTestId('send-button')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'hello');
    expect(screen.getByTestId('send-button')).toBeTruthy();
    expect(screen.queryByTestId('ping-button')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('composer-input'), '   ');
    expect(screen.getByTestId('ping-button')).toBeTruthy();
  });

  it('sends the text, clears the input and reports typing', async () => {
    const { view, onSend, onTyping } = setup();
    await view;
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'hello world');
    expect(onTyping).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('send-button'));
    expect(onSend).toHaveBeenCalledWith('hello world');
    expect(screen.getByTestId('composer-input').props.value).toBe('');
    expect(screen.getByTestId('ping-button')).toBeTruthy();
  });

  it('keeps the text when the send is rejected', async () => {
    const { view } = setup(jest.fn(() => false));
    await view;
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'keep me');
    await fireEvent.press(screen.getByTestId('send-button'));
    expect(screen.getByTestId('composer-input').props.value).toBe('keep me');
  });

  it('toggles the emoji panel', async () => {
    const { view, onToggleEmoji } = setup();
    await view;
    await fireEvent.press(screen.getByTestId('emoji-toggle'));
    expect(onToggleEmoji).toHaveBeenCalled();
  });
});
