// OWA Basic structure observed on mail.mpei.ru. All contents and identifiers are synthetic.
export function inboxHtml({
  page = 1,
  pages = 3,
  empty = false,
  folder = 'folder+test/=',
  selected = true,
} = {}) {
  return `<form id="frm"><table><tr><td class="fld ${selected ? 'sl' : ''}"><a name="lnkFldr" href="?ae=Folder&amp;t=IPF.Note&amp;id=${encodeURIComponent(folder)}&amp;slUsng=0"><img src="15/themes/basic/inbox.png">Входящие</a></td></tr></table>
  <table class="lvw"><tr><th>!</th><th>Письмо</th><th>Вложения</th><th>Выбрать</th>
  <th><a id="lnkColFrom">От</a></th><th><a id="lnkColSubject">Тема</a></th><th><a id="lnkColDeliveryTime">Получено</a></th></tr>
  ${empty ? '' : [0, 1].map((i) => `<tr><td></td><td><img src="15/themes/basic/msg-${i === 0 ? 'unrd' : 'rd'}.png"></td><td>${i === 0 ? '<img src="15/themes/basic/attch.png">' : ''}</td><td><input name="chkmsg" type="checkbox" value="message-${page}-${i}+/="></td><td>Учебный отдел ${i}</td><td><h1><a href="#" onclick="onClkRdMsg(this, 'IPM.Note', ${i}, 0);">Письмо ${page}-${i} &amp; информация</a></h1></td><td>18.09.2026 10:30</td></tr>`).join('')}
  </table><table class="tbft"><tr><td class="pTxt">${page}</td>${page < pages ? `<td><a id="lnkLstPg" onclick="return onClkPg('${pages}');">Последняя</a></td>` : ''}</tr></table></form>`;
}
export function messageHtml(id = 'message-1-0+/=') {
  return `<form id="frm"><input name="hidid" value="${id}"><table class="msgHd"><tr><td class="sub">Полная тема письма</td></tr><tr><td class="frm">Учебный отдел &lt;department@example.test&gt;</td></tr><tr><td class="hdtxt">Отправлено:</td><td class="hdtxnr">18 сентября 2026</td></tr><tr><td><div id="divTo">Студент</div></td></tr><tr><td id="tdAtt"><a href="attachment.ashx?id=file">Расписание.pdf</a></td></tr></table>
 <table><tr><td class="bdy"><div class="bdy"><style>.secret{color:red}</style><script>alert('never')</script><p>Здравствуйте!</p><div>Проверка &lt;тегов&gt;.</div><p><a href="https://example.test/help?q=a&amp;x=b">Подробности</a></p><img src="https://tracker.example.test/pixel"><div hidden>HIDDEN</div><div style="display: none">SECRET</div><p>До встречи!</p></div></td></tr></table></form>`;
}

export function loginHtml(action = '/CookieAuth.dll?Logon') {
  return `<form id="logonForm" method="post" action="${action}"><input name="username"><input type="password" name="password"><input type="hidden" name="curl" value="Z2FowaZ2F"><input type="hidden" name="flags" value="0"><input type="hidden" name="formdir" value="2"><input type="hidden" name="isUtf8" value="1"></form>`;
}
export function metadataResponse(
  action: string,
  request: Record<string, any>,
): Record<string, unknown> {
  if (action === 'GetOwaUserConfiguration')
    return { SessionSettings: { UserEmailAddress: 'student@example.test' } };
  if (action === 'ConvertId')
    return {
      Body: {
        ResponseMessages: {
          Items: request.Body.SourceIds.map((source: { Id: string }) => ({
            ResponseCode: 'NoError',
            AlternateId: { Id: `ews:${source.Id}` },
          })),
        },
      },
    };
  if (action === 'GetItem')
    return {
      Body: {
        ResponseMessages: {
          Items: request.Body.ItemIds.toReversed().map((item: { Id: string }) => ({
            ResponseCode: 'NoError',
            Items: [
              {
                ItemId: item,
                Subject: `Полная тема ${item.Id.slice(4)} без сокращений`,
                From: { Mailbox: { Name: 'Полное имя отправителя' } },
              },
            ],
          })),
        },
      },
    };
  throw new Error('Unexpected mail operation');
}
