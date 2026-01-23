#!/usr/bin/env python3
import argparse
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime

def parse_xlsx(path):
    with zipfile.ZipFile(path) as z:
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            with z.open('xl/sharedStrings.xml') as f:
                tree = ET.parse(f)
                root = tree.getroot()
                ns = {'t': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}
                si_list = root.findall('.//t:si', ns) if ns else root.findall('.//si')
                for si in si_list:
                    texts = []
                    t_nodes = si.findall('.//t:t', ns) if ns else si.findall('.//t')
                    for t in t_nodes:
                        texts.append(t.text or '')
                    shared_strings.append(''.join(texts))

        sheet_name = None
        for name in z.namelist():
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                sheet_name = name
                break
        if not sheet_name:
            raise RuntimeError('No worksheet found in xlsx')

        with z.open(sheet_name) as f:
            tree = ET.parse(f)
            root = tree.getroot()
            ns = {'t': root.tag.split('}')[0].strip('{')} if '}' in root.tag else {}

            rows = []
            for row in root.findall('.//t:row', ns) if ns else root.findall('.//row'):
                cells = {}
                for c in row.findall('t:c', ns) if ns else row.findall('c'):
                    ref = c.attrib.get('r')
                    if not ref:
                        continue
                    t = c.attrib.get('t')
                    v = c.find('t:v', ns) if ns else c.find('v')
                    val = v.text if v is not None else ''
                    if t == 's':
                        try:
                            val = shared_strings[int(val)]
                        except Exception:
                            val = ''
                    elif t == 'inlineStr':
                        is_elem = c.find('t:is', ns) if ns else c.find('is')
                        if is_elem is not None:
                            ts = is_elem.findall('t:t', ns) if ns else is_elem.findall('t')
                            val = ''.join([t.text or '' for t in ts])
                    cells[ref] = val

                def col_index(cell_ref):
                    col = ''.join([ch for ch in cell_ref if ch.isalpha()])
                    idx = 0
                    for ch in col:
                        idx = idx * 26 + (ord(ch.upper()) - ord('A') + 1)
                    return idx

                max_col = 0
                for ref in cells:
                    max_col = max(max_col, col_index(ref))
                row_vals = [''] * max_col
                for ref, val in cells.items():
                    i = col_index(ref) - 1
                    if i >= 0:
                        row_vals[i] = val
                rows.append(row_vals)

            return rows


def normalize_text(value):
    return str(value).strip() if value is not None else ''


def map_sex(value):
    val = normalize_text(value)
    if '男' in val:
        return '男'
    if '女' in val:
        return '女'
    if not val:
        return ''
    return '其他'


def map_training(value):
    val = normalize_text(value)
    if not val:
        return ''
    if 'HYROX' in val.upper():
        return 'HYROX'
    if 'CROSSFIT' in val.upper() or '功能性训练' in val:
        return 'CrossFit'
    if '综合' in val:
        return '综合训练'
    return val


def map_hyrox(value):
    val = normalize_text(value)
    if not val:
        return ''
    if '未参赛' in val:
        return '无参赛经验'
    if '已参赛' in val or '参赛' in val:
        return '有参赛经验'
    return val


def map_partner_role(value):
    val = normalize_text(value)
    if not val:
        return ''
    if '跑步' in val or '心肺' in val:
        return '耐力担当'
    if '功能区' in val or '力量' in val:
        return '力量担当'
    if '节奏' in val:
        return '节奏控场'
    if '均衡' in val or '全能' in val:
        return '全能搭档'
    return val


def parse_tags(value):
    val = normalize_text(value)
    if not val:
        return []
    parts = re.split(r'[┋,，、/]+', val)
    tags = [p.strip() for p in parts if p.strip()]
    # limit to 6 tags
    return tags[:6]


def normalize_mbti(value):
    val = normalize_text(value)
    if not val:
        return ''
    match = re.search(r'([A-Za-z]{4})', val)
    if match:
        return match.group(1).upper()
    return ''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='xlsx path')
    parser.add_argument('--output', default='prefill_users.json', help='json array output path')
    args = parser.parse_args()

    rows = parse_xlsx(args.input)
    if not rows:
        raise RuntimeError('No data rows found')

    header = rows[0]
    header_map = {name: idx for idx, name in enumerate(header)}

    def col(name):
        if name not in header_map:
            raise RuntimeError('Missing column: %s' % name)
        return header_map[name]

    idx_wechat = col('Q1你的微信号是? （用于赛前沟通、分组确认与赛后资料发送，请填写常用微信号）')
    idx_name = col('Q2你的姓名 / 昵称是? （用于现场点名与成绩记录）')
    idx_sex = col('Q4你的性别是?')
    idx_focus = col('Q7你的主要训练方向是?')
    idx_hyrox = col('Q8你的HYROX相关经验是?')
    idx_role = col('Q10你在双人搭档中更适合的角色是?')
    idx_impression = col('Q13如果给你的搭档一个「更好配合的印象」，你更接近哪几项?')
    idx_partner_note = col('Q14|你希望搭档提前知道你的一件事是?')
    idx_mbti = col('Q15你是否了解自己的 MBTI 类型?（不强制填写，不影响分组）')
    idx_tags = col('Q6你平时参与过哪些运动项目?')
    idx_photo = col('Q20请上传一张你的近期最满意的训练或运动照片（用于现场识别、与个人内容展示, 一张即可）')
    idx_created = col('提交答卷时间') if '提交答卷时间' in header_map else None

    now_ts = int(datetime.utcnow().timestamp() * 1000)
    result = []
    seen = set()

    for row in rows[1:]:
        if idx_wechat >= len(row):
            continue
        wechat_id = normalize_text(row[idx_wechat])
        if not wechat_id:
            continue
        if wechat_id in seen:
            continue
        seen.add(wechat_id)

        created_at = now_ts
        if idx_created is not None and idx_created < len(row):
            created_text = normalize_text(row[idx_created])
            # keep raw string; still store numeric now
            created_at = now_ts

        record = {
            'wechatId': wechat_id,
            'nickname': normalize_text(row[idx_name]) if idx_name < len(row) else '',
            'sex': map_sex(row[idx_sex]) if idx_sex < len(row) else '',
            'trainingFocus': map_training(row[idx_focus]) if idx_focus < len(row) else '',
            'hyroxExperience': map_hyrox(row[idx_hyrox]) if idx_hyrox < len(row) else '',
            'partnerRole': map_partner_role(row[idx_role]) if idx_role < len(row) else '',
            'partnerNote': normalize_text(row[idx_partner_note]) if idx_partner_note < len(row) else '',
            'mbti': normalize_mbti(row[idx_mbti]) if idx_mbti < len(row) else '',
            'bio': normalize_text(row[idx_impression]) if idx_impression < len(row) else '',
            'avatarFileId': normalize_text(row[idx_photo]) if idx_photo < len(row) else '',
            'tags': parse_tags(row[idx_tags]) if idx_tags < len(row) else [],
            'role': 'user',
            'status': 'pending',
            'source': 'werox_jan_25_event_signup',
            'createdAt': created_at,
            'updatedAt': now_ts,
        }
        result.append(record)

    out_path = args.output
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    jsonl_path = out_path.replace('.json', '.jsonl') if out_path.endswith('.json') else out_path + '.jsonl'
    with open(jsonl_path, 'w', encoding='utf-8') as f:
        for item in result:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

    print('rows:', len(result))
    print('output:', out_path)
    print('output:', jsonl_path)


if __name__ == '__main__':
    main()
