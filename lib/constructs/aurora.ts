import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface AuroraProps {
  vpc: cdk.aws_ec2.IVpc;
  securityGroup: cdk.aws_ec2.ISecurityGroup;
}

export class Aurora extends Construct {
  constructor(scope: Construct, id: string, props: AuroraProps) {
    super(scope, id);

    // DB Cluster Parameter Group
    const dbClusterParameterGroup = new cdk.aws_rds.ParameterGroup(
      this,
      "DbClusterParameterGroup",
      {
        engine: cdk.aws_rds.DatabaseClusterEngine.auroraPostgres({
          version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_15_2,
        }),
        description: "aurora-postgresql15",
        parameters: {
          log_statement: "none",
          "pgaudit.log": "all",
          "pgaudit.role": "rds_pgaudit",
          shared_preload_libraries: "pgaudit",
        },
      }
    );

    // DB Parameter Group
    const dbParameterGroup = new cdk.aws_rds.ParameterGroup(
      this,
      "DbParameterGroup",
      {
        engine: cdk.aws_rds.DatabaseClusterEngine.auroraPostgres({
          version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_15_2,
        }),
        description: "aurora-postgresql15",
      }
    );

    // Subnet Group
    const subnetGroup = new cdk.aws_rds.SubnetGroup(this, "SubnetGroup", {
      description: "description",
      vpc: props.vpc,
      subnetGroupName: "SubnetGroup",
      vpcSubnets: props.vpc.selectSubnets({
        onePerAz: true,
        subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
      }),
    });

    // Monitoring Role
    const monitoringRole = new cdk.aws_iam.Role(this, "MonitoringRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal(
        "monitoring.rds.amazonaws.com"
      ),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonRDSEnhancedMonitoringRole"
        ),
      ],
    });

    // DB Cluster
    const clusterIdentifier = "db-cluster";
    const dbCluster = new cdk.aws_rds.DatabaseCluster(this, "Default", {
      engine: cdk.aws_rds.DatabaseClusterEngine.auroraPostgres({
        version: cdk.aws_rds.AuroraPostgresEngineVersion.VER_15_2,
      }),
      writer: cdk.aws_rds.ClusterInstance.provisioned("Instance1", {
        instanceType: cdk.aws_ec2.InstanceType.of(
          cdk.aws_ec2.InstanceClass.T3,
          cdk.aws_ec2.InstanceSize.MEDIUM
        ),
        allowMajorVersionUpgrade: false,
        autoMinorVersionUpgrade: true,
        enablePerformanceInsights: true,
        parameterGroup: dbParameterGroup,
        performanceInsightRetention:
          cdk.aws_rds.PerformanceInsightRetention.DEFAULT,
        publiclyAccessible: false,
        instanceIdentifier: "db-instance1",
      }),
      backup: {
        retention: cdk.Duration.days(7),
        preferredWindow: "16:00-16:30",
      },
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_YEAR,
      clusterIdentifier,
      copyTagsToSnapshot: true,
      defaultDatabaseName: "testDB",
      deletionProtection: false,
      iamAuthentication: false,
      monitoringInterval: cdk.Duration.minutes(1),
      monitoringRole,
      parameterGroup: dbClusterParameterGroup,
      preferredMaintenanceWindow: "Sat:17:00-Sat:17:30",
      storageEncrypted: true,
      vpc: props.vpc,
      securityGroups: [props.securityGroup],
      subnetGroup,
    });

    const cfnDbCluster = dbCluster.node
      .defaultChild as cdk.aws_rds.CfnDBCluster;
    cfnDbCluster.manageMasterUserPassword = true;
    cfnDbCluster.masterUsername = "postgresAdmin";
    cfnDbCluster.addPropertyDeletionOverride("MasterUserPassword");
    dbCluster.node.tryRemoveChild("Secret");

    const masterUserSecretArn = cfnDbCluster
      .getAtt("MasterUserSecret.SecretArn")
      .toString();

    new cdk.aws_secretsmanager.CfnRotationSchedule(this, "RotationSchedule", {
      secretId: masterUserSecretArn,
      rotationRules: {
        scheduleExpression: "cron(0 18 ? 1/1 7#1 *)",
        duration: "1h",
      },
    });

    new cdk.CfnOutput(this, "OutputMasterUserSecretArn", {
      value: masterUserSecretArn,
      exportName: "OutputMasterUserSecretArn",
    });
  }
}
