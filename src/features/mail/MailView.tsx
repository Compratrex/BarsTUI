import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { Loader } from '../../shared/ui/Loader.js';
import type { MailGateway, MailMessage, MailPage, MailSummary } from './contracts.js';
import { mailText } from './text.js';

type Row = { text: string; color?: 'cyan'; bold?: boolean; dim?: boolean };
function messageRows(message: MailMessage, columns: number): Row[] {
  const rows: Row[] = [];
  const append = (text: string, style: Omit<Row, 'text'> = {}) => {
    for (const line of wrapAnsi(mailText(text, true), Math.max(1, columns), {
      hard: true,
      trim: false,
    }).split('\n'))
      rows.push({ text: line, ...style });
  };
  append(message.subject, { color: 'cyan', bold: true });
  append(`От: ${message.from}`);
  if (message.to) append(`Кому: ${message.to}`, { dim: true });
  if (message.received) append(message.received, { dim: true });
  if (message.hasAttachments || message.attachments.length)
    append(`Вложения: ${message.attachments.join(', ') || 'есть'} · открыть в веб-почте`, {
      dim: true,
    });
  append('');
  append(message.body || '(Письмо без текста)');
  return rows;
}

export function MailView({
  client,
  columns,
  height,
  onBack,
}: {
  client?: MailGateway;
  columns: number;
  height: number;
  onBack: () => void;
}) {
  const [inbox, setInbox] = useState<MailPage | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [index, setIndex] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const run = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const operation = new AbortController();
    active.current = operation;
    setBusy(label);
    setError('');
    try {
      await work(operation.signal);
    } catch (error) {
      if (mounted.current && !operation.signal.aborted)
        setError(error instanceof Error ? error.message : 'Не удалось загрузить почту.');
    } finally {
      if (active.current === operation) {
        active.current = null;
        if (mounted.current) setBusy('');
      }
    }
  };
  const loadInbox = (page = 1) =>
    void run('Загружаем почту…', async (signal) => {
      if (!client) throw new Error('Почта недоступна в этой сборке приложения.');
      const result = await client.loadInbox(page, signal);
      if (mounted.current && !signal.aborted) {
        setInbox(result);
        setError(result.notice ?? '');
        setIndex((previous) =>
          page === inbox?.page ? Math.min(previous, Math.max(0, result.items.length - 1)) : 0,
        );
        setMessage(null);
      }
    });
  const openMessage = (item: MailSummary) =>
    void run('Открываем письмо…', async (signal) => {
      if (!client) return;
      const result = await client.loadMessage(item, signal);
      if (mounted.current && !signal.aborted) {
        setMessage(result);
        setScroll(0);
        // OWA marks the selected letter as read when its normal reading page opens.
        setInbox(
          (previous) =>
            previous && {
              ...previous,
              items: previous.items.map((entry) =>
                entry.id === item.id ? { ...entry, isRead: true } : entry,
              ),
            },
        );
      }
    });
  useEffect(() => {
    mounted.current = true;
    loadInbox();
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, [client]);
  const body = useMemo(() => (message ? messageRows(message, columns) : []), [message, columns]);
  const errorLines = error
    ? Math.min(
        3,
        wrapAnsi(mailText(error), Math.max(1, columns), { hard: true }).split('\n').length,
      )
    : 0;
  const visibleLines = Math.max(1, height - 5 - errorLines);
  const visibleItems = Math.max(1, Math.floor(visibleLines / 2));
  const inboxRows = useMemo(
    () =>
      (inbox?.items ?? []).flatMap((item, itemIndex) => [
        ...wrapAnsi(mailText(item.subject), Math.max(1, columns - 2), { hard: true })
          .split('\n')
          .map((text, line) => ({ item, itemIndex, text, subject: true, first: line === 0 })),
        {
          item,
          itemIndex,
          text: `${mailText(item.from)} · ${mailText(item.received)}${item.hasAttachments ? ' · вложения' : ''}`,
          subject: false,
          first: false,
        },
      ]),
    [inbox, columns],
  );
  const selectedStart = Math.max(
    0,
    inboxRows.findIndex((row) => row.itemIndex === index),
  );
  const selectedEnd = inboxRows.findIndex((row) => row.itemIndex > index);
  const first = Math.max(
    0,
    Math.min(selectedStart, (selectedEnd < 0 ? inboxRows.length : selectedEnd) - visibleLines),
  );
  const bodyStart = Math.min(scroll, Math.max(0, body.length - visibleLines));
  useInput((input, key) => {
    if (key.ctrl) return;
    if (key.escape) {
      if (active.current) {
        active.current.abort();
        active.current = null;
        setBusy('');
        if (!inbox) onBack();
        return;
      }
      setError('');
      if (message) setMessage(null);
      else onBack();
      return;
    }
    if (active.current) return;
    if (input.toLowerCase() === 'r' || input.toLowerCase() === 'к') {
      if (message) openMessage(message);
      else loadInbox(inbox?.page);
      return;
    }
    if (message) {
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown || input === ' ') {
        const step = key.pageUp || key.pageDown || input === ' ' ? visibleLines : 1;
        setScroll(
          Math.max(
            0,
            Math.min(
              body.length - visibleLines,
              bodyStart + (key.upArrow || key.pageUp ? -step : step),
            ),
          ),
        );
      } else if (input === 'g') setScroll(0);
      else if (input === 'G') setScroll(Math.max(0, body.length - visibleLines));
    } else if (inbox) {
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
        const step = key.pageUp || key.pageDown ? visibleItems : 1;
        setIndex((previous) =>
          Math.max(
            0,
            Math.min(inbox.items.length - 1, previous + (key.upArrow || key.pageUp ? -step : step)),
          ),
        );
      } else if (key.return && inbox.items[index]) openMessage(inbox.items[index]);
      else if (key.leftArrow && inbox.page > 1) loadInbox(inbox.page - 1);
      else if (key.rightArrow && inbox.page < inbox.pages) loadInbox(inbox.page + 1);
    }
  });
  if (busy)
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Loader label={busy} />
        <Text dimColor>Esc — отменить загрузку</Text>
      </Box>
    );
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color="cyan">
          {message
            ? 'Письмо'
            : `Входящие${inbox ? ` · страница ${inbox.page} / ${inbox.pages}` : ''}`}
        </Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {message ? (
          body.slice(bodyStart, bodyStart + visibleLines).map((row, i) => (
            <Text
              key={bodyStart + i}
              color={row.color}
              bold={row.bold}
              dimColor={row.dim}
              wrap="truncate-end"
            >
              {row.text || ' '}
            </Text>
          ))
        ) : !inbox ? (
          <Text dimColor>Письма ещё не загружены. Нажми R, чтобы повторить.</Text>
        ) : !inbox.items.length ? (
          <Text dimColor>Во входящих пока нет писем.</Text>
        ) : (
          inboxRows.slice(first, first + visibleLines).map((row, i) =>
            row.subject ? (
              <Text key={first + i} wrap="truncate-end">
                <Text color={row.item.isRead ? 'gray' : 'cyan'}>
                  {row.first && !row.item.isRead ? '●' : ' '}{' '}
                </Text>
                <Text
                  bold={!row.item.isRead || row.itemIndex === index}
                  color={row.itemIndex === index ? 'black' : undefined}
                  backgroundColor={row.itemIndex === index ? 'cyan' : undefined}
                >
                  {row.text}
                </Text>
              </Text>
            ) : (
              <Text key={first + i} dimColor wrap="truncate-end">
                {' '}
                {row.text}
              </Text>
            ),
          )
        )}
      </Box>
      <Text dimColor wrap="truncate-end">
        {message
          ? `Строки ${bodyStart + 1}–${Math.min(body.length, bodyStart + visibleLines)} / ${body.length} · ↑↓ / PgUp / PgDn прокрутка · g / G начало / конец`
          : '● непрочитанное · ↑↓ / PgUp / PgDn выбор · Enter открыть'}
      </Text>
      <Text dimColor wrap="truncate-end">
        {message ? 'R обновить · Esc ко входящим' : '←→ страницы · R обновить · Esc меню'}
      </Text>
      {error && (
        <Box height={errorLines} overflow="hidden">
          <Text color="red">{mailText(error)}</Text>
        </Box>
      )}
    </Box>
  );
}
