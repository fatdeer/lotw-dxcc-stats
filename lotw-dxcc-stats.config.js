export default {
  lotwUrl: "https://lotw.arrl.org/lotwuser/lotwreport.adi",
  // 优先使用临时数据路径，其次本地调试路径
  localDataPath: "./local-data",
  lotwDataFile: "lotwDxcc.json",
  qsoDataFile: "lotwQso.adif",
  qsoDataFileBackup: false,
  qsoBeginDate: "2018-01-01",
  queryTimeout: 60000,
  queryInterval: 0, // 改为 1 表示1小时间隔

  // 多呼号支持：填写后会为每个呼号生成独立的子目录
  //   local-data/<CALLSIGN>/lotwDxcc.json
  //   local-data/<CALLSIGN>/lotwQso.adif
  // 留空（[]）或不设置时，按 LOTW_USERNAME 单呼号模式工作（向后兼容）
  // 含路径不安全字符（如 '/'）的呼号会被映射为安全的目录名（'/' -> '_'）：
  //   BD4VOJ/QRP -> 子目录 BD4VOJ_QRP/
  callsigns: ["BD4VOJ", "BD4VOJ/QRP"],

  // LoTW 查询参数开关 - 设为 false 可减小 ADIF 文件体积
  // 注意：qsoQslDetail 需要保持为 true，项目依赖其返回的 APP_LoTW_RXQSL / APP_LoTW_QSL_RCVD 字段
  qsoQslDetail: true, // 是否请求 QSL 详细信息（含 QSL 接收时间等，统计增量更新必需）
  qsoMyDetail: false, // 是否请求己方详细信息（含 MY_GRIDSQUARE / MY_CQ_ZONE 等，默认关闭以减小文件）

  // 在保存 ADIF 文件前剥离这些字段，进一步减小文件体积（字段名不区分大小写）
  // 注意：不要把增量更新依赖的字段放入此列表，例如：
  //   APP_LoTW_QSO_TIMESTAMP / APP_LoTW_RXQSL / APP_LoTW_QSL_RCVD / QSL_RCVD / DXCC
  excludeADIFFields: ["APP_LoTW_CQZ", "APP_LoTW_ITUZ"],

  // 超时重试配置
  retryConfig: {
    maxRetries: 4, // 最大重试次数（含首次请求共 4 次尝试）
    retryDelays: [300000, 600000, 1200000], // 重试间隔：5分钟、10分钟、20分钟
    retryOn503: true, // 是否对503错误重试
    retryOnTimeout: true, // 是否对超时错误重试
    retryOnConnectionError: true, // 是否对 ECONNRESET/socket hang up 等连接错误重试
  },
};
