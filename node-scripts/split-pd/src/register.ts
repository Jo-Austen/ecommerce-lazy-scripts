import { basekit, Component, ParamType } from '@lark-opdev/block-basekit-server-api';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// 🟢 缓存 Token，避免重复请求
let cachedToken: string | null = null;

// 获取飞书访问令牌
async function getAccessToken(): Promise<string> {
    if (cachedToken) return cachedToken;

    const { APP_ID, APP_SECRET } = process.env;
    if (!APP_ID || !APP_SECRET) throw new Error('❌ 缺少 APP_ID 或 APP_SECRET');

    const response = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: APP_ID,
        app_secret: APP_SECRET
    });

    cachedToken = response.data?.tenant_access_token;
    if (!cachedToken) throw new Error('❌ 获取 Token 失败');

    console.log('✅ 获取到 Token');
    return cachedToken;
}

// 🟡 通用 API 请求函数
async function apiRequest(method: 'GET' | 'POST', url: string, data?: any) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
      const response = await axios({ method, url, headers, data });

      // 判断请求是否成功
      if (response.data?.code === 0 && response.data?.data) {
          console.log(`✅ 请求成功: ${url}`);
          return response.data.data;
      } else {
          console.warn(`⚠️ 请求失败: ${url}, 错误信息: ${response.data?.msg || '未知错误'}`);
          return null;
      }
  } catch (error: any) {
      console.error(`❌ 请求异常: ${url}`, error.response?.data || error.message);
      return null;
  }
}


// 🔍 获取物料编码 Record ID
async function getMaterialRecordId(name: string, spec: string, unit: string, price: number): Promise<string | null> {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.TABLE_APP_TOKEN}/tables/${process.env.MATERIAL_TABLE_ID}/records/search`;

    const data = {
        filter: {
            conditions: [
                { field_name: '物料名称', operator: 'is', value: [name] },
                { field_name: '规格型号', operator: 'is', value: [spec] },
                { field_name: '计量单位', operator: 'is', value: [unit] },
                { field_name: '标准单价', operator: 'is', value: [price.toString()] }
            ],
            conjunction: 'and'
        },
        field_names: ['物料编码'],
        page_size: 1
    };

    const result = await apiRequest('POST', url, data);
    const recordId = result?.items?.[0]?.record_id;

    if (!recordId) {
        console.warn(`⚠️ 未找到物料：${name} | ${spec} | ${unit} | ${price}`);
        return null;
    }

    console.log(`✅ 物料编码 Record ID: ${recordId}`);
    return recordId;
}

// 🔑 获取采购单 Record ID
async function getPurchaseRecordId(purchaseId: string): Promise<string | null> {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.TABLE_APP_TOKEN}/tables/${process.env.PURCHASE_TABLE_ID}/records/search`;

    const data = {
        automatic_fields: false,
        field_names: ['申请编号'],
        filter: {
            conditions: [{ field_name: '申请编号', operator: 'is', value: [purchaseId] }],
            conjunction: 'and'
        },
        page_size: 1
    };

    const result = await apiRequest('POST', url, data);
    const recordId = result?.items?.[0]?.record_id;

    if (!recordId) {
        console.warn(`⚠️ 未找到采购单号: ${purchaseId}`);
        return null;
    }

    console.log(`✅ 采购单 Record ID: ${recordId}`);
    return recordId;
}

// ✂️ 拆分采购明细
function splitPurchaseDetails(details: string): Array<Record<string, string | number>> {
    details = details.replace(/[\r\n]+/g, ''); //20250721-正式环境的数据比测试环境的多了空行，这有可能是正式环境写入数据失败的原因。
    return details.split(';').map(item => {
        const record: Record<string, string | number> = {};
        item.split('|').forEach(field => {
            const [key, value] = field.split(':').map(part => part.trim());
            if (key && value) record[key] = ['采购数量', '标准单价', '采购价格(元)'].includes(key) ? parseFloat(value) : value;
        });
        return record;
    }).filter(record => record['物料名称'] && record['规格型号'] && record['计量单位'] && record['标准单价'] && record['采购数量']);
}

// 📝 创建明细表记录
async function createDetailRecord(purchaseId: string, detail: Record<string, string | number>) {
    const materialRecordId = await getMaterialRecordId(
        detail['物料名称'] as string,
        detail['规格型号'] as string,
        detail['计量单位'] as string,
        Number(detail['标准单价'])
    );

    if (!materialRecordId) {
        console.warn(`⚠️ 未找到对应物料，跳过写入：${JSON.stringify(detail)}`);
        return;
    }

    const purchaseRecordId = await getPurchaseRecordId(purchaseId);
    if (!purchaseRecordId) throw new Error(`❌ 未找到采购单号 ${purchaseId}`);

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.TABLE_APP_TOKEN}/tables/${process.env.DETAIL_TABLE_ID}/records`;

    const payload = {
        fields: {
            '采购单号': [purchaseRecordId],
            '物料名称': detail['物料名称'],
            '规格型号': detail['规格型号'],
            '计量单位': detail['计量单位'],
            '标准单价': Number(detail['标准单价']) || 0,
            '采购价格(元)': Number(detail['采购价格(元)']) || 0,
            '采购数量': Number(detail['采购数量']) || 0,
            '物料编码': [materialRecordId]
        }
    };

    await apiRequest('POST', url, payload);
    console.log(`✅ 明细写入成功: ${detail['物料名称']}`);
}

// 🚀 注册插件
basekit.addAction({
    formItems: [
        { itemId: 'purchaseId', label: '采购单号', required: true, component: Component.Input },
        { itemId: 'purchaseDetails', label: '采购明细', required: true, component: Component.Input }
    ],

    execute: async (args) => {
        const { purchaseId, purchaseDetails } = args;

        if (!purchaseId || !purchaseDetails) throw new Error('❌ 采购单号和采购明细不能为空');

        const items = splitPurchaseDetails(purchaseDetails);
        if (items.length === 0) throw new Error('❌ 未检测到有效的采购明细');

        let successCount = 0;

        for (const item of items) {
            try {
              await createDetailRecord(purchaseId, item);
              successCount++;  // 只有成功写入时增加计数
            } catch (error) {
              console.warn(`⚠️ 跳过未写入的记录：${JSON.stringify(item)}`);
            }
        }

        return { success: true, message: `✅ 成功写入 ${successCount} 条明细` };
    },

    resultType: {
        type: ParamType.Object,
        properties: {
            success: { type: ParamType.Boolean, label: '执行状态' },
            message: { type: ParamType.String, label: '结果信息' }
        }
    }
});

export default basekit;