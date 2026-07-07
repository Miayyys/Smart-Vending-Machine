# 多阶段构建：maven 打包 -> 轻量 JRE 跑
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app

# 阿里云 Maven 镜像
RUN mkdir -p /root/.m2 && echo '<?xml version="1.0" encoding="UTF-8"?><settings><mirrors><mirror><id>aliyun</id><mirrorOf>central</mirrorOf><name>Aliyun Maven</name><url>https://maven.aliyun.com/repository/public</url></mirror></mirrors></settings>' > /root/.m2/settings.xml

COPY pom.xml .
RUN mvn -B -q dependency:go-offline -s /root/.m2/settings.xml
COPY src ./src
RUN mvn -B -q clean package -DskipTests -s /root/.m2/settings.xml

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENV JAVA_OPTS="-Xms128m -Xmx256m -XX:MaxRAMPercentage=60 -Dfile.encoding=UTF-8"
ENTRYPOINT ["sh","-c","java $JAVA_OPTS -jar app.jar"]
