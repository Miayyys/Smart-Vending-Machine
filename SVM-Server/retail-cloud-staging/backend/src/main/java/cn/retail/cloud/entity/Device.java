package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "device")
public class Device {
    @Id
    private String id;
    private String name;
    private String location;
    private Boolean online;
    private LocalDateTime lastSeen;

    public String getId(){return id;}
    public void setId(String v){this.id=v;}
    public String getName(){return name;}
    public void setName(String v){this.name=v;}
    public String getLocation(){return location;}
    public void setLocation(String v){this.location=v;}
    public Boolean getOnline(){return online;}
    public void setOnline(Boolean v){this.online=v;}
    public LocalDateTime getLastSeen(){return lastSeen;}
    public void setLastSeen(LocalDateTime v){this.lastSeen=v;}
}