import { requireWrite } from '../../_auth.js';

/**
 * Cloudflare Function: 作品データのサーバー保存
 * 
 * 配置先: E:\aninovel\aninovel\functions\api\works\[workId].js
 * 
 * このコードは作品データを Cloudflare KV に保存・取得します。
 * 作者が保存 → 他のユーザーが見ても保存された状態が見える、を実現
 * 
 * 必要な準備:
 *   1. Cloudflare ダッシュボード → Workers & Pages → KV
 *   2. "Create a namespace" で "ANINOVEL_WORKS" を作成
 *   3. ローカルの wrangler.toml に下記を追加:
 *      [[kv_namespaces]]
 *      binding = "WORKS"
 *      id = "<KV namespace ID>"
 *   4. Pages の Settings → Functions → KV namespace bindings で "WORKS" を紐付け
 */

export async function onRequestGet(context) {
  const { params, env } = context;
  const workId = params.workId;
  
  if (!workId) {
    return new Response(JSON.stringify({ error: 'workId required' }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // KV namespace が設定されていない場合のフォールバック
  if (!env.WORKS) {
    return new Response(JSON.stringify({ error: 'KV not configured', data: null }), { 
      status: 503, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const data = await env.WORKS.get(`work:${workId}`, 'json');
    if (!data) {
      return new Response(JSON.stringify({ error: 'not found', data: null }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ data }), { 
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  // このファイルは [id].js と同じ work: キーに書く重複ルート。
  // 検証が甘く CORS も * なので、まず認証で塞ぐ。将来的には削除を検討。
  const denied = requireWrite(context);
  if (denied) return denied;
  const { request, params, env } = context;
  const workId = params.workId;
  
  if (!workId) {
    return new Response(JSON.stringify({ error: 'workId required' }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (!env.WORKS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { 
      status: 503, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const body = await request.json();
    
    // データサイズチェック（25MB制限）
    const sizeBytes = JSON.stringify(body).length;
    if (sizeBytes > 24 * 1024 * 1024) {
      return new Response(JSON.stringify({ 
        error: 'data too large', 
        size: sizeBytes 
      }), { 
        status: 413, 
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // メタデータ追加
    const dataToSave = {
      ...body,
      updatedAt: new Date().toISOString(),
      workId: workId
    };
    
    // KV に保存（30 日 TTL なし = 永続保存）
    await env.WORKS.put(`work:${workId}`, JSON.stringify(dataToSave));
    
    return new Response(JSON.stringify({ 
      success: true, 
      workId, 
      size: sizeBytes,
      updatedAt: dataToSave.updatedAt
    }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// CORS プリフライト対応
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://aninovel.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
