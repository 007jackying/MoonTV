export interface AdminConfig {
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    DoubanProxyType: string;
    DoubanProxy: string;
    DoubanImageProxyType: string;
    DoubanImageProxy: string;
    DisableYellowFilter: boolean;
    // 弹幕接口配置
    DanmakuApiBaseUrl?: string;
    // TVBox 接口开关与访问密码
    TVBoxEnabled?: boolean;
    TVBoxPassword?: string;
  };
  UserConfig: {
    AllowRegister: boolean;
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      group?: string;
      lastOnline?: number;
    }[];
    Groups?: {
      name: string;
      sourceKeys: string[];
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    /**
     * 来自 config.json 的成人源标记，用于 AV 源过滤（见 lib/adult-filter.ts）。
     *
     * 只能在 config.json 里设置：后台的添加/编辑源表单没有这个字段，所以后台新增的
     * 自建源只能靠 `AV-` 名称前缀识别。
     */
    is_adult?: boolean;
    from: 'config' | 'custom';
    /**
     * 生效后的启停状态。
     *
     * 配置文件（本地存储为 config.json，数据库存储为 `ConfigFile`）的 api_site 里
     * 写了 `disabled: true` 的源，这里一定是 `true`：配置里的显式声明优先于存储值
     * （见 lib/config.ts 的 existingSource 分支），所以后台点「启用」对这类源无效，
     * 只能改配置文件。没写 `disabled` 的源则完全由后台管理控制，不受配置重载影响——
     * 这也意味着删掉 `disabled: true` 不会重新启用已保存为停用的源，要显式写 `false`。
     */
    disabled?: boolean;
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  SubscriptionConfig?: {
    subscriptionUrl?: string;
    autoUpdate?: boolean;
    updateInterval?: number; // seconds
    lastUpdated?: number; // timestamp in seconds
    importMode?: 'overwrite' | 'merge';
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
