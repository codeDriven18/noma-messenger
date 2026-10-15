import { memo } from 'react';
import type { Chat, Message, User } from '../../api/types';
import { nameColor } from '../../lib/colors';
import { isEmojiOnly } from '../../lib/format';
import { RichText } from '../../lib/markup';
import { useChats } from '../../store/chats';
import { useUI } from '../../store/ui';
import { CallBubble, FileRow, ForwardHeader, MediaAlbum, Meta, Reactions, ReplyQuote, RetryButton, VideoNote } from './MessageParts';
import { AudioRow, VoicePlayer } from './VoicePlayer';

interface Props {
  message: Message;
  chat: Chat;
  out: boolean;
  first: boolean;
  last: boolean;
  sender?: User;
  showName: boolean;
  highlight?: string;
}

export const MessageBubble = memo(function MessageBubble({ message, chat, out, first, last, sender, showName, highlight }: Props) {
  const atts = message.attachments;
  const visual = atts.filter((a) => a.kind === 'photo' || a.kind === 'video');
  const files = atts.filter((a) => a.kind === 'file');
  const audios = atts.filter((a) => a.kind === 'audio');
  const voice = atts.find((a) => a.kind === 'voice');
  const note = atts.find((a) => a.kind === 'video_note');
  const text = message.text;
  const jump = () => message.reply_to && void useChats.getState().jumpTo(chat.id, message.reply_to.id);

  const name =
    showName && sender ? (
      <div
        className="sender-name"
        style={{ color: nameColor(sender.id) }}
        onClick={(e) => {
          e.stopPropagation();
          useUI.getState().openModal({ kind: 'userProfile', userId: sender.id });
        }}
      >
        {sender.display_name}
        {chat.roles[String(sender.id)] && <span className="role-tag">{chat.roles[String(sender.id)] === 'owner' ? 'владелец' : 'админ'}</span>}
      </div>
    ) : null;

  // Round video message: no bubble at all
  if (note && !text) {
    return (
      <div className="bare-msg">
        {message.forward && <div className="bare-chip"><ForwardHeader message={message} /></div>}
        <VideoNote message={message} att={note} />
        <div className="bare-meta-row">
          <Reactions message={message} compact />
          <Meta message={message} chat={chat} out={out} overlay />
        </div>
        <RetryButton message={message} />
      </div>
    );
  }

  // Big emoji
  if (!atts.length && !message.reply_to && !message.forward && isEmojiOnly(text)) {
    return (
      <div className="bare-msg emoji-msg">
        <span className="big-emoji">{text}</span>
        <div className="bare-meta-row">
          <Reactions message={message} compact />
          <Meta message={message} chat={chat} out={out} overlay />
        </div>
        <RetryButton message={message} />
      </div>
    );
  }

  const mediaOnly = visual.length > 0 && !text && !files.length && !voice && !audios.length;
  const cls = ['bubble', message.type === 'call' ? 'call' : '', out ? 'out' : 'in', first ? 'first' : '', last ? 'last' : '', mediaOnly ? 'media-only' : '', visual.length ? 'has-media' : ''].join(' ');

  return (
    <div className={cls}>
      {name && !mediaOnly && name}
      {message.forward && <ForwardHeader message={message} />}
      {message.reply_to && <ReplyQuote message={message} onJump={jump} />}
      {message.type === 'call' && message.call && <CallBubble message={message} out={out} chat={chat} />}
      {visual.length > 0 && <MediaAlbum message={message} items={visual} hasCaption={!!text} />}
      {voice && <VoicePlayer message={message} att={voice} />}
      {audios.map((a) => (
        <AudioRow key={a.url} message={message} att={a} />
      ))}
      {files.map((a) => (
        <FileRow key={a.url} message={message} att={a} />
      ))}
      {text && (
        <div className="text">
          <RichText text={text} highlight={highlight} />
          <span className={`meta-spacer ${out ? 'out' : ''} ${message.edited_at ? 'edited' : ''}`} />
        </div>
      )}
      <Reactions message={message} />
      {message.type !== 'call' && <Meta message={message} chat={chat} out={out} overlay={mediaOnly} />}
      <RetryButton message={message} />
    </div>
  );
});
