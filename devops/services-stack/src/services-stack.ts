import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
/* import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets'; */

interface ServicesStackProps extends cdk.StackProps {
  githubRepoUrl: string;
  githubRepoBranch?: string;
  // domainName: string;
  sshKeyName: string;
}

export class ServicesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, public props: ServicesStackProps) {
    super(scope, id, props);

    const { instance } = this.createInstance()

    new cdk.CfnOutput(this, 'ServiceInstanceId', {
      value: instance.instanceId,
      description: 'Instance ID of the services host'
    });

    new cdk.CfnOutput(this, 'ServicePublicIP', {
      value: instance.instancePublicIp,
      description: 'Public IP of the services host'
    });
  }

  createInstance() {
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      isDefault: true
    });

    const securityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      securityGroupName: 'ServiceSecurityGroup',
      description: 'Security group for services deployment',
      allowAllOutbound: true
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    const role = new iam.Role(this, 'ServiceInstanceRole', {
      roleName: 'ServiceInstanceRole',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
      ]
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',

      'yum update -y',
      'yum install -y docker git nodejs',

      'usermod -a -G docker ec2-user',
      'systemctl enable docker.service',
      'systemctl start docker.service',

      'wget https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)',
      'mv docker-compose-$(uname -s)-$(uname -m) /usr/local/bin/docker-compose',
      'chmod -v +x /usr/local/bin/docker-compose',

      'mkdir -p /opt/services/management',
      'cd /opt/services/management',

      `git clone ${this.props.githubRepoUrl} .`,
      `git checkout ${this.props.githubRepoBranch || 'main'}`,

      'npm i -g pnpm',
      'pnpm i',

      'cat > /etc/systemd/system/services-management.service << EOL',
      '[Unit]',
      'Description=Services Management Service',
      'After=docker.service',
      'Requires=docker.service',
      '',
      '[Service]',
      'Type=simple',
      'WorkingDirectory=/opt/services/management/apps/management-service',
      'ExecStart=pnpm pm2 start',
      'Restart=always',
      'User=ec2-user',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOL',

      'systemctl daemon-reload',
      'systemctl enable services-management',
      'systemctl start services-management'
    );

    const keyPair = ec2.KeyPair.fromKeyPairName(this, 'ServiceKeyPair', this.props.sshKeyName)

    const instance = new ec2.Instance(this, 'ServiceInstance', {
      vpc,
      instanceName: 'ServiceInstance',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role,
      keyPair,
      userData
    });

    /* const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: this.props.domainName
    });

    new route53.ARecord(this, 'ServiceDNSRecord', {
      zone: hostedZone,
      recordName: `services.${props.domainName}`,
      target: route53.RecordTarget.fromIpAddresses(instance.instancePublicIp)
    }); */

    return { instance }
  }
}
