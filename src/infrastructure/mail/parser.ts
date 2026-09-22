import { mailText } from '../../features/mail/text.js';
import { load } from 'cheerio';
import {
  MailError,
  type MailMessage,
  type MailPage,
  type MailSummary,
} from '../../features/mail/contracts.js';

export const MAIL_URL = 'https://mail.mpei.ru/owa/';

const changed = () =>
  new MailError(
    'Почта вернула незнакомую страницу. Обнови список; если ошибка повторится, открой mail.mpei.ru/owa/.',
  );

export function parseInbox(html: string, requestedPage = 1): MailPage {
  const $ = load(html);
  const inbox = $('a[name="lnkFldr"]')
    .filter((_, el) => $(el).find('img[src$="/inbox.png"]').length > 0)
    .first();
  let url: URL;
  try {
    url = new URL(inbox.attr('href') ?? '', MAIL_URL);
  } catch {
    throw changed();
  }
  const inboxId = url.searchParams.get('id');
  if (
    url.origin !== new URL(MAIL_URL).origin ||
    url.pathname !== '/owa/' ||
    url.searchParams.get('ae') !== 'Folder' ||
    !inboxId ||
    !$('table.lvw').length
  )
    throw changed();
  const column = (id: string) => {
    const th = $(`#${id}`).closest('th');
    if (!th.length) throw changed();
    return th.index();
  };
  const fromColumn = column('lnkColFrom'),
    subjectColumn = column('lnkColSubject'),
    dateColumn = column('lnkColDeliveryTime');
  const items: MailSummary[] = [];
  $('table.lvw input[name="chkmsg"]').each((_, el) => {
    const row = $(el).closest('tr'),
      cells = row.children('td');
    const subject = cells.eq(subjectColumn).find('a[onclick*="onClkRdMsg"]').first();
    const type = subject.attr('onclick')?.match(/onClkRdMsg\(\s*this\s*,\s*['"]([\w.]+)['"]/)?.[1];
    const id = $(el).attr('value');
    if (!id || !type || !cells.eq(dateColumn).length) throw changed();
    items.push({
      id,
      type,
      subject: mailText(subject.text()) || '(Без темы)',
      from: mailText(cells.eq(fromColumn).text()) || 'Неизвестный отправитель',
      received: mailText(cells.eq(dateColumn).text()),
      isRead: !row.find('img[src*="msg-unrd"], .bld').length && !row.hasClass('bld'),
      hasAttachments: row.find('img[src$="/attch.png"]').length > 0,
    });
  });
  const selectedPage = $('.tbft td.pTxt')
    .filter((_, el) => !$(el).find('a').length)
    .map((_, el) => $(el).text().trim())
    .get()
    .find((value) => /^\d+$/.test(value));
  const page = Number(selectedPage) || requestedPage;
  const pages = Math.max(
    page,
    ...$('a[onclick*="onClkPg"]')
      .map(
        (_, el) =>
          Number(
            $(el)
              .attr('onclick')
              ?.match(/onClkPg\(['"]?(\d+)/)?.[1],
          ) || 1,
      )
      .get(),
  );
  return { items, page, pages, inboxId, isInbox: inbox.closest('td').hasClass('sl') };
}

export function plainMailBody(html: string): string {
  const $ = load(html, null, false);
  $(
    'script, style, noscript, iframe, object, embed, svg, head, [hidden], input, button, select, textarea',
  ).remove();
  $('[style]').each((_, el) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(el).attr('style') ?? ''))
      $(el).remove();
  });
  $('a[href]').each((_, el) => {
    const link = $(el),
      href = link.attr('href') ?? '';
    // Insert URLs as text nodes, never as markup or terminal hyperlinks.
    if (/^(https?:\/\/|mailto:)/i.test(href) && !link.text().includes(href))
      link.text(`${link.text()} (${href})`);
  });
  $('br, hr').replaceWith('\n');
  $('li').prepend('• ');
  $(
    'p, div, section, article, header, footer, blockquote, pre, ul, ol, li, tr, h1, h2, h3, h4, h5, h6',
  )
    .prepend('\n')
    .append('\n');
  $('td, th').append('  ');
  return mailText($.root().text(), true);
}

export function parseMailMessage(html: string, item: MailSummary): MailMessage {
  const $ = load(html);
  const body = $('td.bdy > div.bdy').first(),
    header = $('table.msgHd').first();
  if (!body.length || !header.length || $('input[name="hidid"]').attr('value') !== item.id)
    throw changed();
  const date = header
    .find('tr')
    .filter((_, el) =>
      /^(Отправлено|Sent|Дата)\s*:/i.test(mailText($(el).children('td.hdtxt').text())),
    )
    .first()
    .children('td.hdtxnr');
  return {
    ...item,
    isRead: true,
    subject: mailText(header.find('td.sub').text()) || item.subject,
    from: mailText(header.find('td.frm').text()) || item.from,
    received: mailText(date.text()) || item.received,
    to: mailText(header.find('#divTo').text()),
    body: plainMailBody(body.html() ?? ''),
    attachments: header
      .find('#tdAtt a')
      .map((_, el) => mailText($(el).text()))
      .get()
      .filter(Boolean),
  };
}
