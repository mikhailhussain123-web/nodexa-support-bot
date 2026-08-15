function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

function buildTranscript(channel, messages) {
  const rows = [...messages].reverse().map(message => {
    const attachments = [...message.attachments.values()]
      .map(file => `<a href="${escapeHtml(file.url)}">${escapeHtml(file.name || 'attachment')}</a>`).join(' ');
    return `<article><img src="${escapeHtml(message.author.displayAvatarURL())}" alt=""><div><b>${escapeHtml(message.author.tag)}</b><time>${escapeHtml(message.createdAt.toISOString())}</time><p>${escapeHtml(message.content || '').replace(/\n/g, '<br>')}</p>${attachments ? `<p class="files">${attachments}</p>` : ''}</div></article>`;
  }).join('\n');
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>Nodexa ticket transcript</title><style>body{background:#202225;color:#ddd;font:14px Arial;margin:0;padding:24px}header{margin-bottom:24px}article{display:flex;gap:10px;padding:10px;border-top:1px solid #36393f}img{width:36px;height:36px;border-radius:50%}b{color:#fff}time{color:#949ba4;margin-left:8px;font-size:12px}p{margin:6px 0;white-space:normal}.files a{color:#00aff4}</style></head><body><header><h1>${escapeHtml(channel.guild.name)} — #${escapeHtml(channel.name)}</h1><p>Created by Nodexa on ${new Date().toISOString()}</p></header>${rows || '<p>No messages were available.</p>'}</body></html>`, 'utf8');
}

module.exports = { buildTranscript, escapeHtml };
