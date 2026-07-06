package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * 售货柜开门/关门时各楼层抓拍图片记录。
 * 对应表 snapshot。
 */
@Entity
@Table(name = "snapshot",
        indexes = {
            @Index(name = "idx_dev_time", columnList = "device_id,create_time"),
            @Index(name = "idx_floor", columnList = "device_id,floor")
        })
public class Snapshot {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false, length = 32)
    private String deviceId;

    /** 柜内楼层序号 1..N */
    @Column(name = "floor", nullable = false)
    private Integer floor;

    /** OPEN / CLOSE */
    @Column(name = "door_action", nullable = false, length = 16)
    private String doorAction;

    @Column(name = "file_name", length = 128)
    private String fileName;

    /** 服务器端实际存盘文件名 */
    @Column(name = "file_path", nullable = false, length = 255)
    private String filePath;

    @Column(name = "file_size")
    private Long fileSize;

    @Column(length = 64)
    private String md5;

    /** 模型检测结果 JSON */
    @Column(name = "detection_data", columnDefinition = "TEXT")
    private String detectionData;

    /** 检测完成时间 */
    @Column(name = "detected_at")
    private LocalDateTime detectedAt;

    @Column(name = "create_time")
    private LocalDateTime createTime;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public Integer getFloor(){return floor;}
    public void setFloor(Integer v){this.floor=v;}
    public String getDoorAction(){return doorAction;}
    public void setDoorAction(String v){this.doorAction=v;}
    public String getFileName(){return fileName;}
    public void setFileName(String v){this.fileName=v;}
    public String getFilePath(){return filePath;}
    public void setFilePath(String v){this.filePath=v;}
    public Long getFileSize(){return fileSize;}
    public void setFileSize(Long v){this.fileSize=v;}
    public String getMd5(){return md5;}
    public void setMd5(String v){this.md5=v;}
    public String getDetectionData(){return detectionData;}
    public void setDetectionData(String v){this.detectionData=v;}
    public LocalDateTime getDetectedAt(){return detectedAt;}
    public void setDetectedAt(LocalDateTime v){this.detectedAt=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
}