type SolderConfig = {
  db: {
    connectionString: string;
  };
  dev?: {
    enableHotReload?: boolean;
  };
};

export const solderConfig: SolderConfig = {
  db: {
    connectionString: process.env.DATABASE_URL ?? "",
  },
  dev: {
    enableHotReload:
      process.env.SOLDER_ENABLE_HOT_RELOAD !== undefined
        ? process.env.SOLDER_ENABLE_HOT_RELOAD === "true"
        : true,
  },
};
