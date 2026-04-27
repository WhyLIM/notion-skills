#!/usr/bin/env node
/**
 * notionnext-post.mjs
 * NotionNext 博客文章管理脚本
 * API 版本: 2022-06-28
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============ 配置 =============
const API_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// 从环境变量读取配置
const NOTION_API_KEY = process.env.NOTION_API_KEY
  || process.env.NOTION_TOKEN
  || process.env.NOTION_API_TOKEN;

const NOTIONNEXT_DATABASE_ID = process.env.NOTIONNEXT_DATABASE_ID
  || process.env.NOTION_DATABASE_ID;

// ============================================================
// 工具函数
// ============================================================

async function notionRequest(method, path, body = null, query = null) {
  if (!NOTION_API_KEY) {
    throw new Error('缺少 NOTION_API_KEY 环境变量');
  }

  let url = `${NOTION_API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    const errorMsg = data.message || JSON.stringify(data);
    throw new Error(`Notion API 错误 [${res.status}]: ${errorMsg}`);
  }

  return data;
}

/**
 * 将 Markdown 转换为 Notion blocks
 */

/**
 * 解析 Markdown 表格行为 Notion table blocks
 * 支持标准 Markdown 表格语法：
 *   | 列1 | 列2 | 列3 |
 *   |-----|-----|-----|
 *   | 内容 | 内容 | 内容 |
 */
function parseTable(lines, startIdx) {
  const tableLines = [];
  let i = startIdx;

  // 收集所有表格行（直到遇到非表格行或空行）
  while (i < lines.length) {
    const line = lines[i].trim();
    // 跳过分隔行 |---|---|
    if (line.match(/^\|[-:\s]+\|[-:\s]+\|/)) {
      i++;
      continue;
    }
    // 表格行必须以 | 开头
    if (line.startsWith('|')) {
      // 解析单元格
      const cells = line.split('|').slice(1, -1).map(cell => {
        const cellText = cell.trim();
        // 对单元格内容应用内联格式化
        const formatted = parseInlineFormatting(cellText);
        if (formatted.length > 0 && formatted[0].paragraph) {
          return formatted[0].paragraph.rich_text;
        }
        return [{ type: 'text', text: { content: cellText } }];
      });
      tableLines.push(cells);
      i++;
    } else {
      break;
    }
  }

  if (tableLines.length < 2) return { blocks: [], consumed: 0 };

  const numCols = tableLines[0].length;
  // 确保所有行都有相同的列数
  const normalizedRows = tableLines.map(row => {
    while (row.length < numCols) row.push([{ type: 'text', text: { content: '' } }]);
    return row.slice(0, numCols);
  });

  // 第一行作为表头
  const hasColumnHeader = true;
  const blocks = [];

  // 创建 table_row blocks 作为 table 的 children
  const tableChildren = [];
  for (let rowIdx = 0; rowIdx < normalizedRows.length; rowIdx++) {
    const rowCells = normalizedRows[rowIdx];
    // cells 格式: { "cell_0": [...rich_text], "cell_1": [...rich_text], ... }
    const cells = rowCells;  // rowCells 本身就是数组的数组 [[rich_text], [rich_text], ...]
    tableChildren.push({
      object: 'block',
      type: 'table_row',
      table_row: {
        cells,
      }
    });
  }

  // table_block 包含所有 row children（children 放在 table 属性内）
  blocks.push({
    object: 'block',
    type: 'table',
    table: {
      table_width: numCols,
      has_column_header: hasColumnHeader,
      has_row_header: false,
      children: tableChildren,
    },
  });

  return { blocks, consumed: i - startIdx };
}

/**
 * 解析 Markdown 为 Notion blocks（支持表格、图片、任务清单、嵌套列表、链接）
 */
function mdToNotionBlocks(md) {
  if (!md || md.trim() === '') {
    return [];
  }

  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  // 检测缩进级别（每2个空格为一级）
  function getIndent(line) {
    const match = line.match(/^(\s*)/);
    return Math.floor((match ? match[1].length : 0) / 2);
  }

  // 判断是否是列表项，返回 { type: 'ul'|'ol'|'todo', text, indent, checked }
  function parseListMarker(line) {
    const todoMatch = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.+)$/);
    if (todoMatch) return { type: 'todo', indent: getIndent(line), text: todoMatch[3], checked: todoMatch[2].toLowerCase() === 'x' };

    const ulMatch = line.match(/^(\s*)- (.+)$/);
    if (ulMatch) return { type: 'ul', indent: getIndent(line), text: ulMatch[2] };

    const olMatch = line.match(/^(\s*)(\d+)\. (.+)$/);
    if (olMatch) return { type: 'ol', indent: getIndent(line), text: olMatch[3], number: parseInt(olMatch[2]) };

    return null;
  }

  // 解析单个列表项及其嵌套子项
  function parseListGroup(lines, startIdx) {
    const groupBlocks = [];
    let i = startIdx;

    while (i < lines.length) {
      const line = lines[i];
      const marker = parseListMarker(line);

      if (!marker) break;

      const blockType = marker.type === 'todo' ? 'to_do' : (marker.type === 'ul' ? 'bulleted_list_item' : 'numbered_list_item');
      const baseIndent = marker.indent;

      // 解析内联格式（包括链接）
      const formatted = parseInlineFormatting(marker.text);
      const richText = formatted.length > 0 && formatted[0].paragraph ? formatted[0].paragraph.rich_text : [{ type: 'text', text: { content: marker.text } }];

      // 提取链接用于 to_do checked
      let checked = false;
      if (marker.type === 'todo') {
        checked = marker.checked;
      }

      const block = { object: 'block', type: blockType };
      if (blockType === 'to_do') {
        block.to_do = { rich_text: richText, checked };
      } else if (blockType === 'bulleted_list_item') {
        block.bulleted_list_item = { rich_text: richText };
      } else {
        block.numbered_list_item = { rich_text: richText };
      }

      // 收集直接子项（缩进更大的连续列表项）
      const children = [];
      i++;
      while (i < lines.length) {
        const childLine = lines[i];
        const childMarker = parseListMarker(childLine);
        if (!childMarker) { i++; continue; }
        if (childMarker.indent <= baseIndent) break;

        // 子项的缩进必须比父项多至少1级
        if (childMarker.indent > baseIndent) {
          // 收集所有缩进 >= childIndent 的连续子行
          const childIndent = childMarker.indent;
          const subChildren = [];
          while (i < lines.length) {
            const subLine = lines[i];
            const subMarker = parseListMarker(subLine);
            if (!subMarker || subMarker.indent < childIndent) break;
            if (subMarker.indent === childIndent) {
              const subFormatted = parseInlineFormatting(subMarker.text);
              const subRichText = subFormatted.length > 0 && subFormatted[0].paragraph ? subFormatted[0].paragraph.rich_text : [{ type: 'text', text: { content: subMarker.text } }];
              const subBlockType = subMarker.type === 'todo' ? 'to_do' : (subMarker.type === 'ul' ? 'bulleted_list_item' : 'numbered_list_item');
              const subBlock = { object: 'block', type: subBlockType };
              if (subBlockType === 'to_do') {
                subBlock.to_do = { rich_text: subRichText, checked: subMarker.checked };
              } else if (subBlockType === 'bulleted_list_item') {
                subBlock.bulleted_list_item = { rich_text: subRichText };
              } else {
                subBlock.numbered_list_item = { rich_text: subRichText };
              }
              subChildren.push(subBlock);
              i++;
            } else {
              // subMarker.indent > childIndent - 更深的嵌套，暂不支持多级
              break;
            }
          }
          if (subChildren.length > 0) {
            // 将连续的同级子项作为第一个子项的 children
            // 简化处理：每个子项可能有自己的嵌套
            // 实际上 Notion 的列表嵌套是一层，这里只处理一层 children
            children.push(...subChildren);
          }
        } else {
          break;
        }
      }

      // Notion API: children 直接放在 block 内
      if (children.length > 0) {
        block[blockType === 'to_do' ? 'to_do' : blockType === 'bulleted_list_item' ? 'bulleted_list_item' : 'numbered_list_item'].children = children;
      }

      groupBlocks.push(block);
    }

    return { blocks: groupBlocks, consumed: i - startIdx };
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 图片: ![alt](url)
    const imgMatch = line.match(/^!\[(.*?)\]\((https?:\/\/[^)]+)\)/);
    if (imgMatch) {
      blocks.push({
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: imgMatch[2] } },
      });
      i++;
      continue;
    }

    // 表格（必须在代码块之前检测）
    if (line.trim().startsWith('|') && i + 1 < lines.length) {
      const result = parseTable(lines, i);
      if (result.blocks.length > 0) {
        blocks.push(...result.blocks);
        i += result.consumed;
        continue;
      }
    }

    // 代码块
    if (line.match(/^```(\w*)$/)) {
      const lang = line.match(/^```(\w*)$/)?.[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          language: lang || 'plain text',
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
        },
      });
      i++;
      continue;
    }

    // 标题 ###
    const h3Match = line.match(/^### (.+)$/);
    if (h3Match) {
      const formatted = parseInlineFormatting(h3Match[1]);
      const richText = formatted.length > 0 && formatted[0].paragraph ? formatted[0].paragraph.rich_text : [{ type: 'text', text: { content: h3Match[1] } }];
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: richText } });
      i++; continue;
    }

    // 标题 ##
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      const formatted = parseInlineFormatting(h2Match[1]);
      const richText = formatted.length > 0 && formatted[0].paragraph ? formatted[0].paragraph.rich_text : [{ type: 'text', text: { content: h2Match[1] } }];
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText } });
      i++; continue;
    }

    // 标题 #
    const h1Match = line.match(/^# (.+)$/);
    if (h1Match) {
      const formatted = parseInlineFormatting(h1Match[1]);
      const richText = formatted.length > 0 && formatted[0].paragraph ? formatted[0].paragraph.rich_text : [{ type: 'text', text: { content: h1Match[1] } }];
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: richText } });
      i++; continue;
    }

    // 分隔线
    if (line.match(/^---+$/)) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      i++; continue;
    }

    // 引用
    const quoteMatch = line.match(/^> (.+)$/);
    if (quoteMatch) {
      const formatted = parseInlineFormatting(quoteMatch[1]);
      if (formatted.length > 0 && formatted[0].paragraph) {
        blocks.push({ object: 'block', type: 'quote', quote: { rich_text: formatted[0].paragraph.rich_text } });
      } else {
        blocks.push({ object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: quoteMatch[1] } }] } });
      }
      i++; continue;
    }

    // 列表项（包括任务清单）- 使用 parseListGroup 处理嵌套
    const listMarker = parseListMarker(line);
    if (listMarker) {
      const result = parseListGroup(lines, i);
      blocks.push(...result.blocks);
      i += result.consumed;
      continue;
    }

    // 普通段落（支持链接）
    const paragraphBlocks = parseInlineFormatting(line);
    if (paragraphBlocks.length > 0) {
      blocks.push(...paragraphBlocks);
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } });
    }
    i++;
  }

  return blocks;
}

/**
 * 解析内联格式（支持加粗、斜体、删除线、代码、链接）
 */
function parseInlineFormatting(text, allowLinks = true) {
  if (!text.trim()) return [];

  // 通用的 rich_text 构造器
  const buildRichTexts = (regex, getAnnotations) => {
    const matches = [...text.matchAll(regex)];
    if (matches.length === 0) return null;
    const richTexts = [];
    let lastIndex = 0;
    for (const m of matches) {
      if (m.index > lastIndex) {
        richTexts.push({ type: 'text', text: { content: text.slice(lastIndex, m.index) } });
      }
      richTexts.push(m[2] ?    { type: 'text', text: { content: m[1], link: { url: m[2] } }, annotations: getAnnotations(m) } :    { type: 'text', text: { content: m[1] }, annotations: getAnnotations(m) });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) {
      richTexts.push({ type: 'text', text: { content: text.slice(lastIndex) } });
    }
    return richTexts;
  };

  // inline code: `code`
  let rich = buildRichTexts(/`([^`]+)`/g, () => ({ code: true }));
  if (rich) return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }];

  // strikethrough: ~~text~~
  rich = buildRichTexts(/~~(.+?)~~/g, () => ({ strikethrough: true }));
  if (rich) return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }];

  // bold italic: ***text***
  rich = buildRichTexts(/\*\*\*(.+?)\*\*\*/g, () => ({ bold: true, italic: true }));
  if (rich) return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }];

  // bold: **text**
  rich = buildRichTexts(/\*\*(.+?)\*\*/g, () => ({ bold: true }));
  if (rich) return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }];

  // italic: *text*
  rich = buildRichTexts(/\*(.+?)\*/g, () => ({ italic: true }));
  if (rich) return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }];

  // link: [text](url) - only if allowLinks is true
  if (allowLinks) {
    rich = buildRichTexts(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, () => ({}));
    if (rich) return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } }];
  }

  if (text.trim()) {
    return [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }];
  }
  return [];
}

/**
 * 格式化石梶 block 为可读文本
 */
function formatBlock(block) {
  const getText = (richText) => {
    if (!richText) return '';
    return richText.map(r => r.plain_text || r.text?.content || '').join('');
  };

  switch (block.type) {
    case 'heading_1': return `# ${getText(block.heading_1?.rich_text)}`;
    case 'heading_2': return `## ${getText(block.heading_2?.rich_text)}`;
    case 'heading_3': return `### ${getText(block.heading_3?.rich_text)}`;
    case 'paragraph': return getText(block.paragraph?.rich_text);
    case 'bulleted_list_item': return `• ${getText(block.bulleted_list_item?.rich_text)}`;
    case 'numbered_list_item': return `${block.numbered_list_item?.number || ''}. ${getText(block.numbered_list_item?.rich_text)}`;
    case 'quote': return `> ${getText(block.quote?.rich_text)}`;
    case 'code': return `\`\`\`${block.code?.language || ''}\n${getText(block.code?.rich_text)}\n\`\`\``;
    case 'divider': return '---';
    case 'to_do': return `[${block.to_do?.checked ? 'x' : ' '}] ${getText(block.to_do?.rich_text)}`;
    case 'image':
      const imgUrl = block.image?.external?.url || block.image?.file?.url || '';
      return `![image](${imgUrl})`;
    case 'table': {
      if (!block.table?.children?.length) return '[table]';
      return block.table.children.map(row => {
        const cells = row.table_row?.cells || [];
        return '| ' + cells.map(cell => getText(cell) || '').join(' | ') + ' |';
      }).join('\n');
    }
    default: return `[${block.type}]`;
  }
}

/**
 * 格式化了梶页面属性
 */
function formatPage(page) {
  const props = page.properties || {};
  const title = props.title?.title?.[0]?.plain_text || props.Name?.title?.[0]?.plain_text || '(无标题)';
  const status = props.status?.select?.name || '';
  const category = props.category?.select?.name || '';
  const tags = props.tags?.multi_select?.map(t => t.name).join(', ') || '';
  const slug = props.slug?.rich_text?.[0]?.plain_text || '';
  const date = props.date?.date?.start || '';
  const summary = props.summary?.rich_text?.[0]?.plain_text || '';

  return {
    id: page.id,
    title,
    status,
    category,
    tags,
    slug,
    date,
    summary,
    url: `https://notion.so/${page.id.replace(/-/g, '')}`,
  };
}

/**
 * 中文转拼音 slug
 */
function chineseToPinyin(str) {
  const pinDict = {
    '啊': 'a', '阿': 'a', '爱': 'ai', '安': 'an', '暗': 'an', '奥': 'ao', '八': 'ba', '巴': 'ba',
    '吧': 'ba', '把': 'ba', '爸': 'ba', '白': 'bai', '百': 'bai', '拜': 'bai', '班': 'ban',
    '半': 'ban', '办': 'ban', '帮': 'bang', '包': 'bao', '保': 'bao', '报': 'bao', '北': 'bei',
    '被': 'bei', '本': 'ben', '比': 'bi', '笔': 'bi', '边': 'bian', '变': 'bian', '便': 'bian',
    '别': 'bie', '病': 'bing', '不': 'bu', '步': 'bu', '部': 'bu', '擦': 'ca', '猜': 'cai',
    '才': 'cai', '财': 'cai', '彩': 'cai', '菜': 'cai', '参': 'can', '草': 'cao', '层': 'ceng',
    '茶': 'cha', '查': 'cha', '差': 'cha', '常': 'chang', '场': 'chang', '唱': 'chang', '超': 'chao',
    '车': 'che', '晨': 'chen', '城': 'cheng', '成': 'cheng', '吃': 'chi', '持': 'chi', '出': 'chu',
    '除': 'chu', '楚': 'chu', '处': 'chu', '穿': 'chuan', '春': 'chun', '词': 'ci', '此': 'ci',
    '次': 'ci', '从': 'cong', '村': 'cun', '错': 'cuo', '打': 'da', '大': 'da', '带': 'dai',
    '代': 'dai', '单': 'dan', '但': 'dan', '蛋': 'dan', '道': 'dao', '到': 'dao', '得': 'de',
    '灯': 'deng', '等': 'deng', '低': 'di', '底': 'di', '点': 'dian', '电': 'dian', '店': 'dian',
    '掉': 'diao', '顶': 'ding', '定': 'ding', '丢': 'diu', '东': 'dong', '冬': 'dong', '懂': 'dong',
    '动': 'dong', '读': 'du', '短': 'duan', '段': 'duan', '对': 'dui', '多': 'duo', '夺': 'duo',
    '饿': 'e', '恶': 'e', '儿': 'er', '耳': 'er', '二': 'er', '发': 'fa', '法': 'fa', '翻': 'fan',
    '反': 'fan', '饭': 'fan', '方': 'fang', '房': 'fang', '放': 'fang', '非': 'fei', '飞': 'fei',
    '费': 'fei', '分': 'fen', '份': 'fen', '风': 'feng', '封': 'feng', '服': 'fu', '父': 'fu',
    '付': 'fu', '复': 'fu', '该': 'gai', '改': 'gai', '干': 'gan', '感': 'gan', '刚': 'gang',
    '高': 'gao', '告': 'gao', '哥': 'ge', '歌': 'ge', '个': 'ge', '给': 'gei', '跟': 'gen',
    '根': 'gen', '工': 'gong', '公共': 'gonggong', '共': 'gong', '狗': 'gou', '够': 'gou', '古': 'gu',
    '故': 'gu', '瓜': 'gua', '挂': 'gua', '关': 'guan', '管': 'guan', '光': 'guang', '广': 'guang',
    '逛': 'guang', '贵': 'gui', '国': 'guo', '果': 'guo', '过': 'guo', '还': 'hai', '孩': 'hai',
    '海': 'hai', '害': 'hai', '汉': 'han', '好': 'hao', '号': 'hao', '喝': 'he', '何': 'he',
    '合': 'he', '和': 'he', '黑': 'hei', '很': 'hen', '红': 'hong', '后': 'hou', '候': 'hou',
    '呼': 'hu', '湖': 'hu', '虎': 'hu', '护': 'hu', '花': 'hua', '化': 'hua', '话': 'hua',
    '画': 'hua', '划': 'hua', '坏': 'huai', '欢': 'huan', '还': 'huan', '环': 'huan', '换': 'huan',
    '黄': 'huang', '回': 'hui', '汇': 'hui', '会': 'hui', '婚': 'hun', '活': 'huo', '火': 'huo',
    '或': 'huo', '机': 'ji', '鸡': 'ji', '级': 'ji', '极': 'ji', '几': 'ji', '己': 'ji',
    '记': 'ji', '季': 'ji', '继': 'ji', '济': 'ji', '加': 'jia', '家': 'jia', '价': 'jia',
    '架': 'jia', '件': 'jian', '建': 'jian', '剑': 'jian', '健': 'jian', '将': 'jiang', '讲': 'jiang',
    '交': 'jiao', '郊': 'jiao', '脚': 'jiao', '叫': 'jiao', '街': 'jie', '节': 'jie', '姐': 'jie',
    '解': 'jie', '介': 'jie', '今': 'jin', '金': 'jin', '近': 'jin', '进': 'jin', '仅': 'jin',
    '尽': 'jin', '紧': 'jin', '锦': 'jin', '京': 'jing', '经': 'jing', '精': 'jing', '景': 'jing',
    '静': 'jing', '九': 'jiu', '久': 'jiu', '酒': 'jiu', '旧': 'jiu', '就': 'jiu', '举': 'ju',
    '句': 'ju', '剧': 'ju', '聚': 'ju', '觉': 'jue', '决': 'jue', '绝': 'jue', '军': 'jun',
    '开': 'kai', '看': 'kan', '考': 'kao', '靠': 'kao', '科': 'ke', '可': 'ke', '课': 'ke',
    '刻': 'ke', '客': 'ke', '空': 'kong', '恐': 'kong', '口': 'kou', '哭': 'ku', '苦': 'ku',
    '快': 'kuai', '块': 'kuai', '会': 'kuai', '宽': 'kuan', '况': 'kuang', '矿': 'kuang', '亏': 'kui',
    '困': 'kun', '拉': 'la', '来': 'lai', '蓝': 'lan', '老': 'lao', '乐': 'le', '累': 'lei',
    '冷': 'leng', '离': 'li', '里': 'li', '理': 'li', '礼': 'li', '历': 'li', '利': 'li',
    '立': 'li', '力': 'li', '连': 'lian', '联': 'lian', '脸': 'lian', '练': 'lian', '凉': 'liang',
    '两': 'liang', '亮': 'liang', '量': 'liang', '林': 'lin', '临': 'lin', '零': 'ling', '领': 'ling',
    '另': 'ling', '留': 'liu', '流': 'liu', '六': 'liu', '龙': 'long', '楼': 'lou', '露': 'lu',
    '路': 'lu', '旅': 'lv', '绿': 'lv', '论': 'lun', '伦': 'lun', '轮': 'lun', '落': 'luo',
    '妈': 'ma', '马': 'ma', '吗': 'ma', '买': 'mai', '卖': 'mai', '慢': 'man', '满': 'man',
    '忙': 'mang', '猫': 'mao', '毛': 'mao', '冒': 'mao', '么': 'me', '没': 'mei', '每': 'mei',
    '美': 'mei', '妹': 'mei', '门': 'men', '们': 'men', '梦': 'meng', '迷': 'mi', '米': 'mi',
    '面': 'mian', '民': 'min', '明': 'ming', '名': 'ming', '命': 'ming', '母': 'mu', '木': 'mu',
    '目': 'mu', '拿': 'na', '哪': 'na', '那': 'na', '奶': 'nai', '男': 'nan', '南': 'nan',
    '呢': 'ne', '内': 'nei', '能': 'neng', '你': 'ni', '年': 'nian', '念': 'nian', '鸟': 'niao',
    '您': 'nin', '宁': 'ning', '牛': 'niu', '农': 'nong', '女': 'nv', '暖': 'nuan', '欧': 'ou',
    '怕': 'pa', '拍': 'pai', '派': 'pai', '盘': 'pan', '判': 'pan', '跑': 'pao', '配': 'pei',
    '朋': 'peng', '皮': 'pi', '片': 'pian', '漂': 'piao', '票': 'piao', '拼': 'pin', '品': 'pin',
    '平': 'ping', '评': 'ping', '苹': 'ping', '破': 'po', '迫': 'po', '铺': 'pu', '期': 'qi',
    '七': 'qi', '期': 'qi', '其': 'qi', '奇': 'qi', '骑': 'qi', '起': 'qi', '气': 'qi',
    '汽': 'qi', '器': 'qi', '去': 'qu', '取': 'qu', '趣': 'qu', '全': 'quan', '却': 'que',
    '确': 'que', '群': 'qun', '然': 'ran', '让': 'rang', '绕': 'rao', '热': 're', '人': 'ren',
    '认': 'ren', '日': 'ri', '容': 'rong', '肉': 'rou', '如': 'ru', '入': 'ru', '软': 'ruan',
    '若': 'ruo', '三': 'san', '散': 'san', '色': 'se', '森': 'sen', '杀': 'sha', '沙': 'sha',
    '山': 'shan', '上': 'shang', '少': 'shao', '社': 'she', '舍': 'she', '身': 'shen', '深': 'shen',
    '什': 'shen', '生': 'sheng', '声': 'sheng', '师': 'shi', '十': 'shi', '时': 'shi', '实': 'shi',
    '食': 'shi', '始': 'shi', '使': 'shi', '世': 'shi', '市': 'shi', '事': 'shi', '是': 'shi',
    '室': 'shi', '试': 'shi', '视': 'shi', '收': 'shou', '手': 'shou', '首': 'shou', '受': 'shou',
    '书': 'shu', '树': 'shu', '术': 'shu', '双': 'shuang', '水': 'shui', '睡': 'shui', '顺': 'shun',
    '说': 'shuo', '思': 'si', '司': 'si', '死': 'si', '四': 'si', '送': 'song', '诉': 'su',
    '速': 'su', '宿': 'su', '算': 'suan', '虽': 'sui', '岁': 'sui', '孙': 'sun', '所': 'suo',
    '他': 'ta', '她': 'ta', '它': 'ta', '台': 'tai', '太': 'tai', '态': 'tai', '谈': 'tan',
    '叹': 'tan', '探': 'tan', '汤': 'tang', '糖': 'tang', '特': 'te', '疼': 'teng', '提': 'ti',
    '题': 'ti', '体': 'ti', '天': 'tian', '田': 'tian', '条': 'tiao', '跳': 'tiao', '铁': 'tie',
    '听': 'ting', '停': 'ting', '通': 'tong', '同': 'tong', '头': 'tou', '图': 'tu', '团': 'tuan',
    '推': 'tui', '腿': 'tui', '外': 'wai', '弯': 'wan', '完': 'wan', '玩': 'wan', '晚': 'wan',
    '万': 'wan', '王': 'wang', '往': 'wang', '网': 'wang', '忘': 'wang', '望': 'wang', '危': 'wei',
    '位': 'wei', '文': 'wen', '问': 'wen', '我': 'wo', '屋': 'wu', '五': 'wu', '午': 'wu',
    '物': 'wu', '务': 'wu', '误': 'wu', '西': 'xi', '吸': 'xi', '希': 'xi', '息': 'xi',
    '习': 'xi', '洗': 'xi', '系': 'xi', '细': 'xi', '下': 'xia', '夏': 'xia', '先': 'xian',
    '险': 'xian', '现': 'xian', '线': 'xian', '相': 'xiang', '想': 'xiang', '向': 'xiang', '象': 'xiang',
    '像': 'xiang', '小': 'xiao', '校': 'xiao', '笑': 'xiao', '些': 'xie', '写': 'xie', '谢': 'xie',
    '新': 'xin', '心': 'xin', '信': 'xin', '星': 'xing', '行': 'xing', '形': 'xing', '醒': 'xing',
    '姓': 'xing', '休': 'xiu', '修': 'xiu', '需': 'xu', '许': 'xu', '学': 'xue', '雪': 'xue',
    '血': 'xue', '压': 'ya', '呀': 'ya', '牙': 'ya', '言': 'yan', '研': 'yan', '眼': 'yan',
    '演': 'yan', '阳': 'yang', '养': 'yang', '样': 'yang', '药': 'yao', '要': 'yao', '爷': 'ye',
    '也': 'ye', '夜': 'ye', '业': 'ye', '叶': 'ye', '页': 'ye', '医': 'yi', '衣': 'yi',
    '一': 'yi', '以': 'yi', '已': 'yi', '意': 'yi', '易': 'yi', '因': 'yin', '音': 'yin',
    '银': 'yin', '印': 'yin', '英': 'ying', '应': 'ying', '影': 'ying', '用': 'yong', '由': 'you',
    '油': 'you', '游': 'you', '友': 'you', '有': 'you', '又': 'you', '右': 'you', '鱼': 'yu',
    '雨': 'yu', '语': 'yu', '元': 'yuan', '原': 'yuan', '园': 'yuan', '远': 'yuan', '院': 'yuan',
    '愿': 'yuan', '月': 'yue', '越': 'yue', '云': 'yun', '运': 'yun', '在': 'zai', '再': 'zai',
    '早': 'zao', '怎': 'zen', '曾': 'zeng', '站': 'zhan', '张': 'zhang', '找': 'zhao', '照': 'zhao',
    '者': 'zhe', '这': 'zhe', '真': 'zhen', '知': 'zhi', '之': 'zhi', '只': 'zhi', '直': 'zhi',
    '职': 'zhi', '植': 'zhi', '值': 'zhi', '止': 'zhi', '至': 'zhi', '制': 'zhi', '治': 'zhi',
    '中': 'zhong', '终': 'zhong', '钟': 'zhong', '重': 'zhong', '周': 'zhou', '洲': 'zhou', '主': 'zhu',
    '住': 'zhu', '注': 'zhu', '著': 'zhu', '抓': 'zhua', '专': 'zhuan', '转': 'zhuan', '装': 'zhuang',
    '准': 'zhun', '子': 'zi', '字': 'zi', '自': 'zi', '走': 'zou', '租': 'zu', '足': 'zu',
    '组': 'zu', '卒': 'zu', '祖': 'zu', '阻': 'zu', '最': 'zui', '昨': 'zuo', '左': 'zuo',
    '作': 'zuo', '做': 'zuo', '坐': 'zuo', '座': 'zuo',
  };

  let result = '';
  for (const char of str) {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) result += char;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) result += char.toLowerCase();
    else if (pinDict[char]) result += pinDict[char];
  }
  result = result.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return result || 'untitled';
}

function generateSlug(title) {
  return chineseToPinyin(title).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// ============================================================
// 命令实现
// ============================================================

async function cmdCreate(args) {
  const {
    title,
    category = null,
    tags = null,
    slug = null,
    date = getToday(),
    status = 'Published',
    summary = '',
    md = null,
    'md-file': mdFile = null,
  } = args;

  if (!title) throw new Error('缺少参数: --title');
  if (!NOTIONNEXT_DATABASE_ID) throw new Error('缺少 NOTIONNEXT_DATABASE_ID 环境变量');

  let content = md || '';
  if (mdFile) content = readFileSync(mdFile, 'utf-8');

  const properties = {
    title: { title: [{ type: 'text', text: { content: title } }] },
    type: { select: { name: 'Post' } },
    status: { select: { name: status } },
    date: { date: { start: date } },
    slug: { rich_text: [{ type: 'text', text: { content: slug || generateSlug(title) } }] },
    summary: { rich_text: [{ type: 'text', text: { content: summary } }] },
  };

  if (category) properties.category = { select: { name: category } };
  if (tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) properties.tags = { multi_select: tagList.map(name => ({ name })) };
  }

  const body = {
    parent: { database_id: NOTIONNEXT_DATABASE_ID },
    properties,
  };

  if (content.trim()) {
    body.children = mdToNotionBlocks(content);
  }

  const result = await notionRequest('POST', '/pages', body);

  console.log('✅ 文章创建成功!');
  console.log(`   页面 ID: ${result.id}`);
  console.log(`   标题: ${title}`);
  console.log(`   slug: ${slug || generateSlug(title)}`);
  console.log(`   链接: https://notion.so/${result.id.replace(/-/g, '')}`);

  return result;
}

async function cmdExport(args) {
  const { page } = args;
  if (!page) throw new Error('缺少参数: --page <page-id>');

  const blocksRes = await notionRequest('GET', `/blocks/${page}/children`);

  console.log(`📄 页面内容 (${blocksRes.results.length} blocks)\n`);
  for (const block of blocksRes.results) {
    console.log(formatBlock(block));
  }

  return blocksRes;
}

async function cmdAppend(args) {
  const { page, md = null, 'md-file': mdFile = null } = args;
  if (!page) throw new Error('缺少参数: --page <page-id>');

  let content = md || '';
  if (mdFile) content = readFileSync(mdFile, 'utf-8');
  if (!content.trim()) throw new Error('缺少内容: --md 或 --md-file');

  const blocks = mdToNotionBlocks(content);
const BATCH_SIZE = 100;
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    await notionRequest('PATCH', `/blocks/${page}/children`, { children: batch });
  }

  console.log(`✅ 成功追加 ${blocks.length} 个块到页面 ${page}`);
  return true;
}

async function cmdList(args) {
  const {
    category = null,
    status = null,
    tag = null,
    limit: limitArg = null,
    all = false,
  } = args;

  const limit = (all ? 1000 : (parseInt(limitArg) || 20));

  if (!NOTIONNEXT_DATABASE_ID) throw new Error('缺少 NOTIONNEXT_DATABASE_ID 环境变量');

  // 构建 filter
  const filter = {
    and: [
      { property: 'type', select: { equals: 'Post' } },
    ],
  };

  if (category) {
    filter.and.push({ property: 'category', select: { equals: category } });
  }
  if (status) {
    filter.and.push({ property: 'status', select: { equals: status } });
  }
  if (tag) {
    filter.and.push({ property: 'tags', multi_select: { contains: tag } });
  }

  // 分页获取
  const pages = [];
  let cursor = undefined;
  const maxPages = all ? 100 : Math.ceil(limit / 100);

  for (let i = 0; i < maxPages; i++) {
    const effectiveLimit = all ? 100 : limit;
    const body = {
      filter,
      sorts: [{ property: 'date', direction: 'descending' }],
      page_size: Math.min(100, effectiveLimit),
    };
    if (cursor) body.start_cursor = cursor;

    const result = await notionRequest('POST', `/databases/${NOTIONNEXT_DATABASE_ID}/query`, body);
    pages.push(...result.results);

    if (!result.has_more || result.results.length === 0) break;
    cursor = result.next_cursor;
  }

  const limited = pages.slice(0, limit);

  console.log(`📋 共 ${limited.length} 篇文章:\n`);
  for (const page of limited) {
    const p = formatPage(page);
    console.log(`【${p.status}】${p.title}`);
    console.log(`   分类: ${p.category || '-'} | 标签: ${p.tags || '-'} | 日期: ${p.date}`);
    console.log(`   slug: ${p.slug}`);
    console.log(`   ID: ${p.id}`);
    console.log();
  }

  return limited;
}

async function cmdUpdate(args) {
  const { page, ...updates } = args;
  if (!page) throw new Error('缺少参数: --page <page-id>');
  if (Object.keys(updates).length === 0) throw new Error('缺少更新属性: --set key=value');

  const properties = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'category') {
      properties.category = { select: { name: value } };
    } else if (key === 'status') {
      properties.status = { select: { name: value } };
    } else if (key === 'tags') {
      const tagList = value.split(',').map(t => t.trim()).filter(Boolean);
      properties.tags = { multi_select: tagList.map(name => ({ name })) };
    } else if (key === 'slug') {
      properties.slug = { rich_text: [{ type: 'text', text: { content: value } }] };
    } else if (key === 'summary') {
      properties.summary = { rich_text: [{ type: 'text', text: { content: value } }] };
    } else if (key === 'title') {
      properties.title = { title: [{ type: 'text', text: { content: value } }] };
    } else if (key === 'date') {
      properties.date = { date: { start: value } };
    }
  }

  const result = await notionRequest('PATCH', `/pages/${page}`, { properties });
  console.log(`✅ 更新成功: ${page}`);
  return result;
}

// ============================================================
// 参数解析
// ============================================================

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const [,, command, ...rawArgs] = process.argv;

  if (!command) {
    console.log(`
notionnext-post.mjs - NotionNext 博客文章管理

用法:
  node notionnext-post.mjs create   [--title "标题" --category "分类" --tags "标签1,标签2" ...]
  node notionnext-post.mjs export   --page <page-id>
  node notionnext-post.mjs append   --page <page-id> --md "内容" 或 --md-file <file>
  node notionnext-post.mjs list     [--category "分类"] [--status Published] [--tag "标签"] [--limit 20]
  node notionnext-post.mjs update   --page <page-id> --set key=value [--set key2=value2]

环境变量:
  NOTION_API_KEY         Notion API Key
  NOTIONNEXT_DATABASE_ID NotionNext 数据库 ID

示例:
  node notionnext-post.mjs create --title "我的文章" --category "技术分享" --tags "Python,AI" --md "# Hello\n\nWorld"
  node notionnext-post.mjs list --category "技术分享" --status Published --limit 10
  node notionnext-post.mjs export --page <page-id>
  node notionnext-post.mjs update --page <page-id> --set status=Published --set category=AI
`);
    process.exit(0);
  }

  const args = parseArgs(rawArgs);

  try {
    let result;
    switch (command) {
      case 'create':
        result = await cmdCreate(args);
        break;
      case 'export':
        result = await cmdExport(args);
        break;
      case 'append':
        result = await cmdAppend(args);
        break;
      case 'list':
        result = await cmdList(args);
        break;
      case 'update':
        result = await cmdUpdate(args);
        break;
      default:
        console.error(`未知命令: ${command}`);
        process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error(`❌ 错误: ${err.message}`);
    process.exit(1);
  }
}

main();

