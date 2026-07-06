package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "firmware")
public class Firmware {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 32)
    private String version;

    @Column(name = "file_name", length = 128)
    private String fileName;

    @Column(name = "file_path", length = 255)
    private String filePath;

    @Column(name = "file_size")
    private Long fileSize;

    @Column(length = 64)
    private String md5;

    @Column(length = 255)
    private String description;

    @Column(name = "create_time")
    private LocalDateTime createTime;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getVersion(){return version;}
    public void setVersion(String v){this.version=v;}
    public String getFileName(){return fileName;}
    public void setFileName(String v){this.fileName=v;}
    public String getFilePath(){return filePath;}
    public void setFilePath(String v){this.filePath=v;}
    public Long getFileSize(){return fileSize;}
    public void setFileSize(Long v){this.fileSize=v;}
    public String getMd5(){return md5;}
    public void setMd5(String v){this.md5=v;}
    public String getDescription(){return description;}
    public void setDescription(String v){this.description=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
}
